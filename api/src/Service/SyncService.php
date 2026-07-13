<?php
declare(strict_types=1);

namespace Depo\Service;

use Depo\Core\Db;
use Depo\Core\HttpException;
use Depo\Core\Uuid;
use Depo\Repository\CategoryRepository;
use Depo\Repository\ChangeLogRepository;
use Depo\Repository\LocationRepository;
use Depo\Repository\PartRepository;
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
        $this->stock = new StockRepository($db, $tenantId);
        $this->tx = new TransactionRepository($db, $tenantId);
        $this->changeLog = new ChangeLogRepository($db, $tenantId);
        $this->syncOps = new SyncOpRepository($db, $tenantId);
        $this->stockService = new StockService($db, $tenantId);
    }

    // --- BOOTSTRAP (SYNC_PROTOCOL §5.1) -------------------------------------

    /** @return array<string,mixed> */
    public function bootstrap(): array
    {
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
            'stock_snapshot'     => $this->stock->snapshot(),
            'stock_transactions' => $this->tx->recentForBootstrap(90),
            'cursor'             => $this->changeLog->maxSeq(),
            'server_time'        => Time::now(),
        ];
    }

    // --- PULL (SYNC_PROTOCOL §5.2) ------------------------------------------

    /** @return array{changes:list<array<string,mixed>>,cursor:int,has_more:bool} */
    public function pull(int $since, int $limit): array
    {
        return $this->changeLog->since($since, $limit);
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

        foreach ($ops as $op) {
            $opId = is_string($op['op_id'] ?? null) ? $op['op_id'] : '';
            if (!Uuid::isV7($opId)) {
                $rejected[] = ['op_id' => $opId, 'reason' => 'invalid_op_id', 'message' => 'op_id UUIDv7 değil'];
                continue;
            }

            try {
                // Her op kendi transaction'ında: effect + change_log + sync_ops atomik.
                $this->db->transaction(function () use ($opId, $op): void {
                    $this->applyOp($opId, $op);
                });
                $applied[] = $opId;
            } catch (HttpException $e) {
                $rejected[] = ['op_id' => $opId, 'reason' => $e->getErrorCode(), 'message' => $e->getMessage()];
            } catch (\PDOException $e) {
                // op_id yarışı (PK ihlali) → zaten uygulanmış kabul et (idempotent).
                if ($this->syncOps->exists($opId)) {
                    $applied[] = $opId;
                } else {
                    $rejected[] = ['op_id' => $opId, 'reason' => 'db_error', 'message' => 'Veritabanı hatası'];
                }
            }
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
                $repo = $this->catalogRepo($entity);
                $row = $repo->lwwUpsert($data);
                $this->changeLog->append($entity, (string) ($row['id'] ?? ''), 'upsert', $row, $this->actorId);
                break;

            case 'delete':
                $entity = (string) ($op['entity'] ?? '');
                $repo = $this->catalogRepo($entity);
                $id = (string) ($data['id'] ?? '');
                $row = $repo->softDelete($id, is_string($data['updated_at'] ?? null) ? $data['updated_at'] : null);
                $this->changeLog->append($entity, $id, 'delete', $row, $this->actorId);
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

    private function catalogRepo(string $entity): PartRepository|LocationRepository|CategoryRepository
    {
        return match ($entity) {
            'part'     => $this->parts,
            'location' => $this->locations,
            'category' => $this->categories,
            default    => throw HttpException::unprocessable('Senkronlanamayan varlık: ' . $entity),
        };
    }
}
