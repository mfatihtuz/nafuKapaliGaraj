<?php
declare(strict_types=1);

namespace Depo\Service;

use Depo\Core\Db;
use Depo\Core\HttpException;
use Depo\Core\Uuid;
use Depo\Repository\AttachmentRepository;
use Depo\Repository\CategoryRepository;
use Depo\Repository\ChangeLogRepository;
use Depo\Repository\LocationRepository;
use Depo\Repository\BomRepository;
use Depo\Repository\PartRepository;
use Depo\Repository\ProjectRepository;
use Depo\Repository\StockRepository;
use Depo\Repository\SyncOpRepository;
use Depo\Repository\TransactionRepository;
use Depo\Support\Time;

/**
 * Offline-first senkronizasyon motoru (SYNC_PROTOCOL). Projenin kalbi.
 *
 *   pull  → since'den büyük değişiklikler
 *   push  → op'ları idempotent uygula (op başına transaction)
 *   bootstrap → ilk kurulumda tüm veri
 */
final class SyncService
{
    private PartRepository $parts;
    private LocationRepository $locations;
    private CategoryRepository $categories;
    private AttachmentRepository $attachments;
    private ProjectRepository $projects;
    private BomRepository $bom;
    private StockRepository $stock;
    private TransactionRepository $tx;
    private ChangeLogRepository $changeLog;
    private SyncOpRepository $syncOps;
    private StockService $stockService;

    public function __construct(
        private readonly Db $db,
        private readonly string $tenantId,
        private readonly ?string $actorId,
        int $clockSkewMinutes = 5,
    ) {
        $this->parts = new PartRepository($db, $tenantId, $clockSkewMinutes);
        $this->locations = new LocationRepository($db, $tenantId, $clockSkewMinutes);
        $this->categories = new CategoryRepository($db, $tenantId, $clockSkewMinutes);
        $this->attachments = new AttachmentRepository($db, $tenantId, $clockSkewMinutes);
        $this->projects = new ProjectRepository($db, $tenantId, $clockSkewMinutes);
        $this->bom = new BomRepository($db, $tenantId, $clockSkewMinutes);
        $this->stock = new StockRepository($db, $tenantId);
        $this->tx = new TransactionRepository($db, $tenantId, $clockSkewMinutes);
        $this->changeLog = new ChangeLogRepository($db, $tenantId);
        $this->syncOps = new SyncOpRepository($db, $tenantId);
        $this->stockService = new StockService($db, $tenantId, $clockSkewMinutes);
    }

    // --- BOOTSTRAP (SYNC_PROTOCOL §5.1) -------------------------------------

    /**
     * @return array<string,mixed>
     *
     * Tüm okumalar TEK transaction içinde (InnoDB REPEATABLE READ → tutarlı snapshot):
     * snapshot, ledger ve cursor aynı ana ait olur. Böylece bootstrap penceresinde
     * commit edilen bir hareket ya snapshot'a girer ya da cursor'dan büyük seq ile
     * pull'da gelir — asla kaybolmaz, asla iki kez sayılmaz.
     */
    public function bootstrap(): array
    {
        return $this->db->transaction(function (): array {
            $tenant = $this->db->one(
                'SELECT id, name, plan, locale, settings FROM tenants WHERE id = :id',
                ['id' => $this->tenantId]
            );
            if ($tenant !== null && isset($tenant['settings']) && is_string($tenant['settings'])) {
                $tenant['settings'] = json_decode($tenant['settings'], true);
            }

            return [
                'tenant'             => $tenant,
                'categories'         => $this->categories->allActive(),
                'locations'          => $this->locations->allActive(),
                'parts'              => $this->parts->allActive(),
                'attachments'        => $this->attachments->allActive(),
                'projects'           => $this->projects->allActive(),
                'bom_items'          => $this->bom->allActive(),
                'stock_snapshot'     => $this->stock->snapshot(),
                'stock_transactions' => $this->tx->recentForBootstrap(90),
                'cursor'             => $this->changeLog->maxSeq(),
                'server_time'        => Time::now(),
            ];
        });
    }

    // --- PULL (SYNC_PROTOCOL §5.2) ------------------------------------------

    /** @return array{changes:list<array<string,mixed>>,cursor:int,has_more:bool} */
    public function pull(int $since, int $limit): array
    {
        return $this->changeLog->since($since, $limit);
    }

    // --- CHECKSUM / SELF-HEAL (SYNC_PROTOCOL §5.6) --------------------------

    /**
     * Stok görünümünün deterministik özeti. İstemci kendi yerel özetini bununla
     * karşılaştırır; ayrışma varsa (sessiz stok kayması — türetme hatası, yarım
     * uygulanmış tx) yeniden bootstrap ederek sunucu doğrusuna hizalanır.
     *
     * Kanonik satır: "part_id:location_id:qtyMilli:level" — tümü ASCII.
     * Sıralama SORT_STRING (bayt sırası) → istemcideki JS varsayılan (code-unit)
     * sıralamasıyla BİREBİR aynı (tüm karakterler <128). SQL ORDER BY kullanılmaz;
     * çünkü utf8mb4 collation'ı JS ile ayrışabilir.
     *
     * @return array{checksum:string,rows:int,server_time:string}
     */
    public function checksum(): array
    {
        $rows = $this->db->all(
            'SELECT part_id, location_id, qty, level FROM stock WHERE tenant_id = :tid',
            ['tid' => $this->tenantId]
        );
        return [
            'checksum'    => self::stockChecksum($rows),
            'rows'        => count($rows),
            'server_time' => Time::now(),
        ];
    }

    /**
     * Stok satırlarından kanonik SHA-256 üretir. İstemci (checksum.ts) ile
     * BİREBİR aynı algoritma; ikisi ayrışırsa self-heal tetiklenir.
     * @param list<array<string,mixed>> $rows
     */
    public static function stockChecksum(array $rows): string
    {
        $lines = [];
        foreach ($rows as $r) {
            $qtyMilli = (int) round(((float) $r['qty']) * 1000);
            $level = $r['level'] !== null && $r['level'] !== '' ? (string) $r['level'] : '';
            $lines[] = $r['part_id'] . ':' . $r['location_id'] . ':' . $qtyMilli . ':' . $level;
        }
        sort($lines, SORT_STRING); // bayt sırası — JS default sort ile aynı (ASCII)
        return hash('sha256', implode("\n", $lines));
    }

    // --- PUSH (SYNC_PROTOCOL §5.3) ------------------------------------------

    /**
     * @param list<array<string,mixed>> $ops
     * @return array{applied:list<string>,rejected:list<array<string,mixed>>,cursor:int}
     */
    public function push(array $ops): array
    {
        $applied = [];
        $rejected = [];

        // Tenant-bazlı serileştirme: eşzamanlı iki push'ta change_log.seq'in commit
        // sırası ile artış sırası ayrışabilir; araya giren bir pull, cursor'ı ileri
        // taşıyıp henüz commit edilmemiş küçük seq'li satırı SONSUZA DEK atlardı.
        // GET_LOCK paylaşımlı hostingde çalışır; alınamazsa hata → istemci sonra dener.
        $lockName = null;
        if ($this->db->isMysql()) {
            $lockName = 'depo:push:' . $this->tenantId;
            // Kilit beklemesi KISA (2sn): kaybeden worker'ı 10sn boyunca tutup php-fpm
            // havuzunu tüketmesin (çok sekme/cihazda 20sn zaman aşımının kaynağıydı).
            // Kaybeden hızlı 429 alır; istemci outbox üstel-backoff ile sonra dener.
            $got = $this->db->one('SELECT GET_LOCK(:n, 2) AS l', ['n' => $lockName]);
            if ((int) ($got['l'] ?? 0) !== 1) {
                throw HttpException::tooManyRequests('Eşzamanlı senkronizasyon — biraz sonra tekrar deneyin');
            }
        }
        try {
            return $this->pushLocked($ops, $applied, $rejected);
        } finally {
            if ($lockName !== null) {
                $this->db->run('SELECT RELEASE_LOCK(:n)', ['n' => $lockName]);
            }
        }
    }

    /**
     * @param list<array<string,mixed>> $ops
     * @param list<string> $applied
     * @param list<array<string,mixed>> $rejected
     * @return array{applied:list<string>,rejected:list<array<string,mixed>>,cursor:int}
     */
    private function pushLocked(array $ops, array $applied, array $rejected): array
    {
        // TÜM batch tek dış transaction'da → op başına 1 COMMIT/fsync yerine 1 fsync
        // (70 op'luk cascade eskiden ~70 fsync = saniyeler; artık ~1). Op-başına
        // izolasyon SAVEPOINT ile: bir op reddedilince yalnız o geri alınır, kalanlar sürer.
        $this->db->begin();
        try {
            foreach ($ops as $op) {
                $opId = is_string($op['op_id'] ?? null) ? $op['op_id'] : '';
                if (!Uuid::isV7($opId)) {
                    $rejected[] = ['op_id' => $opId, 'reason' => 'invalid_op_id', 'message' => 'op_id UUIDv7 değil'];
                    continue;
                }

                $this->db->savepoint();
                try {
                    $this->applyOp($opId, $op);
                    $applied[] = $opId;
                } catch (HttpException $e) {
                    $this->db->rollbackToSavepoint(); // yalnız bu op geri, batch sürer
                    $rejected[] = ['op_id' => $opId, 'reason' => $e->getErrorCode(), 'message' => $e->getMessage()];
                } catch (\PDOException $e) {
                    // Savepoint'e dönülemiyorsa (ör. deadlock ile tüm tx iptal) batch'i iptal et.
                    try {
                        $this->db->rollbackToSavepoint();
                    } catch (\PDOException) {
                        throw $e;
                    }
                    // op_id yarışı (PK ihlali) → zaten uygulanmış kabul et (idempotent).
                    if ($this->syncOps->exists($opId)) {
                        $applied[] = $opId;
                    } else {
                        $rejected[] = ['op_id' => $opId, 'reason' => 'db_error', 'message' => 'Veritabanı hatası'];
                    }
                }
            }
            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollback();
            throw $e;
        }

        return [
            'applied'  => $applied,
            'rejected' => $rejected,
            'cursor'   => $this->changeLog->maxSeq(),
        ];
    }

    /** Tek bir op'u uygular. Transaction içinde çağrılır. */
    private function applyOp(string $opId, array $op): void
    {
        // Idempotency: zaten uygulanmışsa atla (SYNC_PROTOCOL §5.3, Test 2/5).
        if ($this->syncOps->exists($opId)) {
            return;
        }

        $type = (string) ($op['type'] ?? '');
        $data = is_array($op['data'] ?? null) ? $op['data'] : [];

        switch ($type) {
            case 'upsert':
                $entity = (string) ($op['entity'] ?? '');
                // GÜVENLİK (kritik): Ek metadata'sı İSTEMCİDEN upsert edilemez. attachments
                // satırlarını yalnızca sunucu, /api/files yükleme ucunda (AttachmentService::store)
                // yazar — storage_path/mime/sha256 sunucu-denetimlidir. Sync push ile serbest
                // upsert'e izin vermek istemciye storage_path'i ezdirir → path traversal /
                // keyfi dosya okuma (private/config.php, çapraz-tenant). İstemci yalnızca DELETE
                // push eder (aşağıdaki case). Bu yüzden attachment upsert'i burada reddedilir.
                if ($entity === 'attachment') {
                    throw HttpException::unprocessable('Ek metadata istemciden güncellenemez');
                }
                $repo = $this->catalogRepo($entity);
                $row = $repo->lwwUpsert($data);
                $this->changeLog->append($entity, (string) ($row['id'] ?? ''), 'upsert', $row, $this->actorId);
                break;

            case 'delete':
                $entity = (string) ($op['entity'] ?? '');
                $repo = $this->catalogRepo($entity);
                $id = (string) ($data['id'] ?? '');
                $updatedAt = is_string($data['updated_at'] ?? null) ? $data['updated_at'] : null;
                $row = $repo->softDelete($id, $updatedAt);
                $this->changeLog->append($entity, $id, 'delete', $row, $this->actorId);
                // Proje soft-delete → BOM satırlarını da SUNUCUDA soft-delete et (başka cihazın
                // eklediği, silen cihazın yerelinde olmayan satırlar da temizlensin — bulgu #4;
                // soft-delete FK CASCADE'i tetiklemez). Her biri change_log'a düşer → yayılır.
                if ($entity === 'project') {
                    foreach ($this->bom->forProject($id) as $child) {
                        $childRow = $this->bom->softDelete((string) $child['id'], $updatedAt);
                        $this->changeLog->append('bom_item', (string) $child['id'], 'delete', $childRow, $this->actorId);
                    }
                }
                break;

            case 'stock_move':
                $tx = $this->stockService->applyMove($data, $this->actorId);
                $this->changeLog->append('stock_transaction', (string) $tx['id'], 'upsert', $tx, $this->actorId);
                break;

            case 'stock_audit':
                $tx = $this->stockService->applyAudit($data, $this->actorId);
                $this->changeLog->append('stock_transaction', (string) $tx['id'], 'upsert', $tx, $this->actorId);
                break;

            default:
                throw HttpException::unprocessable('Bilinmeyen op tipi: ' . $type);
        }

        $this->syncOps->record($opId);
    }

    private function catalogRepo(string $entity): PartRepository|LocationRepository|CategoryRepository|AttachmentRepository|ProjectRepository|BomRepository
    {
        return match ($entity) {
            'part'       => $this->parts,
            'location'   => $this->locations,
            'category'   => $this->categories,
            'attachment' => $this->attachments, // yalnızca delete/sort push edilir; yükleme ayrı endpoint
            'project'    => $this->projects,     // FAZ 3a — LWW katalog
            'bom_item'   => $this->bom,          // FAZ 3a — proje op'undan SONRA (FK sırası)
            default      => throw HttpException::unprocessable('Senkronlanamayan varlık: ' . $entity),
        };
    }
}
