<?php
declare(strict_types=1);

namespace Depo\Repository;

use Depo\Core\Db;
use Depo\Core\HttpException;
use Depo\Core\Uuid;
use Depo\Support\Time;

/**
 * stock_transactions — APPEND-ONLY defter (CLAUDE.md §6, PRD §4.5).
 * UPDATE/DELETE yok. Düzeltme = ters kayıt.
 */
final class TransactionRepository
{
    public function __construct(
        private readonly Db $db,
        private readonly string $tenantId,
        private readonly int $clockSkewMinutes = 5,
    ) {}

    /**
     * Deftere bir hareket ekler. part_id ve location_id tenant'a ait olmalı.
     * @param array<string,mixed> $data
     * @return array<string,mixed> Eklenen kanonik satır (change_log payload'ı için).
     */
    public function append(array $data, ?string $actorId): array
    {
        $id = is_string($data['id'] ?? null) && Uuid::isValid($data['id']) ? $data['id'] : Uuid::v7();
        $partId = (string) ($data['part_id'] ?? '');
        $locationId = (string) ($data['location_id'] ?? '');

        $this->assertBelongsToTenant('parts', $partId, 'Parça bulunamadı');
        $this->assertBelongsToTenant('locations', $locationId, 'Konum bulunamadı');

        $reason = (string) ($data['reason'] ?? 'adjust');
        $allowedReasons = ['purchase','consume','transfer','adjust','audit','scrap','loan_out','loan_return','initial'];
        if (!in_array($reason, $allowedReasons, true)) {
            throw HttpException::unprocessable('Geçersiz reason: ' . $reason);
        }

        // created_at geleceğe-karşı sınırlanır (SYNC_PROTOCOL §7): geçmiş olaylar korunur,
        // gelecekten gelen damgalar now()+skew ile kapanır — level LWW'yi kalıcı kilitlemesin.
        $createdAt = Time::clampUpdatedAt(is_string($data['created_at'] ?? null) ? $data['created_at'] : null, $this->clockSkewMinutes);

        $delta = $data['delta'] ?? null;
        $levelTo = $data['level_to'] ?? null;
        if ($levelTo !== null && !in_array($levelTo, ['full','low','empty'], true)) {
            throw HttpException::unprocessable('Geçersiz level_to');
        }

        $this->db->run(
            'INSERT INTO stock_transactions
                (id, tenant_id, part_id, location_id, delta, level_to, reason, project_id, ref_id, note, actor_id, created_at)
             VALUES
                (:id, :tid, :pid, :lid, :delta, :level_to, :reason, :project_id, :ref_id, :note, :actor, :created_at)',
            [
                'id' => $id, 'tid' => $this->tenantId, 'pid' => $partId, 'lid' => $locationId,
                'delta' => $delta !== null ? (float) $delta : null,
                'level_to' => $levelTo,
                'reason' => $reason,
                'project_id' => $data['project_id'] ?? null,
                'ref_id' => $data['ref_id'] ?? null,
                'note' => isset($data['note']) ? mb_substr((string) $data['note'], 0, 255) : null,
                'actor' => $actorId,
                'created_at' => $createdAt,
            ]
        );

        // Savunma derinliği: dönüş SELECT'i de tenant kapsamlı.
        return $this->db->one(
            'SELECT * FROM stock_transactions WHERE id = :id AND tenant_id = :tid',
            ['id' => $id, 'tid' => $this->tenantId]
        ) ?? [];
    }

    /**
     * Bootstrap: yalnızca son N günlük hareketler. @return list<array<string,mixed>>
     * NOT: Eskiden "OR reason='initial'" ile TÜM açılış hareketleri (yaşına bakılmaksızın)
     * gönderiliyordu → bootstrap payload'ı sınırsız büyüyordu. Snapshot zaten güncel
     * qty/level taşıdığından (stok ondan yazılır, applyBootstrap) doğruluk bozulmaz;
     * eski geçmiş gerekirse parça detayında istek üzerine çekilir.
     */
    public function recentForBootstrap(int $sinceDays = 90): array
    {
        $cutoff = (new \DateTimeImmutable("-{$sinceDays} days", new \DateTimeZone('UTC')))->format('Y-m-d H:i:s.v');
        return $this->db->all(
            "SELECT * FROM stock_transactions
              WHERE tenant_id = :tid AND created_at >= :cutoff
              ORDER BY created_at ASC",
            ['tid' => $this->tenantId, 'cutoff' => $cutoff]
        );
    }

    /** Bir parçanın hareket geçmişi. @return list<array<string,mixed>> */
    public function forPart(string $partId, int $limit = 200): array
    {
        return $this->db->all(
            'SELECT * FROM stock_transactions
              WHERE tenant_id = :tid AND part_id = :pid
              ORDER BY created_at DESC
              LIMIT ' . max(1, min($limit, 1000)),
            ['tid' => $this->tenantId, 'pid' => $partId]
        );
    }

    private function assertBelongsToTenant(string $table, string $id, string $notFoundMsg): void
    {
        if (!Uuid::isValid($id)) {
            throw HttpException::unprocessable('Geçersiz id: ' . $id);
        }
        $row = $this->db->one(
            "SELECT tenant_id FROM {$table} WHERE id = :id",
            ['id' => $id]
        );
        // Yok VEYA başka tenant → 404 (varlığı sızdırma).
        if ($row === null || (string) $row['tenant_id'] !== $this->tenantId) {
            throw HttpException::notFound($notFoundMsg);
        }
    }
}
