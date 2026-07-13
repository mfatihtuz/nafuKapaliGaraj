<?php
declare(strict_types=1);

namespace Depo\Service;

use Depo\Core\Db;
use Depo\Core\HttpException;
use Depo\Repository\StockRepository;
use Depo\Repository\TransactionRepository;
use Depo\Support\Time;

/**
 * Hareket uygula → stok türet (SPRINT_PLAN 1.5).
 * Stok DAİMA hareketten türetilir; miktar asla doğrudan yazılmaz (SYNC_PROTOCOL §1).
 */
final class StockService
{
    private TransactionRepository $txRepo;
    private StockRepository $stockRepo;

    public function __construct(
        private readonly Db $db,
        private readonly string $tenantId,
    ) {
        $this->txRepo = new TransactionRepository($db, $tenantId);
        $this->stockRepo = new StockRepository($db, $tenantId);
    }

    /**
     * stock_move op'u: exact modda delta, level modda level_to.
     * @param array<string,mixed> $data
     * @return array<string,mixed> Eklenen hareket (change_log payload'ı).
     */
    public function applyMove(array $data, ?string $actorId): array
    {
        $delta = $data['delta'] ?? null;
        $levelTo = $data['level_to'] ?? null;

        if ($delta === null && $levelTo === null) {
            throw HttpException::unprocessable('Hareket için delta veya level_to gerekli');
        }

        $tx = $this->txRepo->append($data, $actorId);
        $createdAt = Time::isoToMysql(is_string($data['created_at'] ?? null) ? $data['created_at'] : null);

        $partId = (string) $tx['part_id'];
        $locationId = (string) $tx['location_id'];

        if ($delta !== null) {
            $this->stockRepo->applyDelta($partId, $locationId, (float) $delta, $createdAt);
        }
        if ($levelTo !== null) {
            $this->stockRepo->setLevel($partId, $locationId, (string) $levelTo, $createdAt);
        }

        return $tx;
    }

    /**
     * stock_audit op'u (SYNC_PROTOCOL §5.3):
     * mevcut qty'yi oku → delta = counted_qty - current → reason='audit' ile move işle.
     * @param array<string,mixed> $data
     * @return array<string,mixed>
     */
    public function applyAudit(array $data, ?string $actorId): array
    {
        $partId = (string) ($data['part_id'] ?? '');
        $locationId = (string) ($data['location_id'] ?? '');
        if ($partId === '' || $locationId === '') {
            throw HttpException::unprocessable('audit için part_id ve location_id gerekli');
        }
        if (!array_key_exists('counted_qty', $data)) {
            throw HttpException::unprocessable('audit için counted_qty gerekli');
        }

        $current = $this->stockRepo->getQty($partId, $locationId);
        $delta = (float) $data['counted_qty'] - $current;

        return $this->applyMove([
            'id'          => $data['id'] ?? null,
            'part_id'     => $partId,
            'location_id' => $locationId,
            'delta'       => $delta,
            'reason'      => 'audit',
            'note'        => $data['note'] ?? null,
            'created_at'  => $data['created_at'] ?? null,
        ], $actorId);
    }
}
