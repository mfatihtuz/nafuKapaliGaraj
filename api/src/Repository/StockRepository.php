<?php
declare(strict_types=1);

namespace Depo\Repository;

use Depo\Core\Db;
use Depo\Core\Uuid;
use Depo\Support\Time;

/**
 * stock — defterden TÜRETİLMİŞ görünüm. ASLA doğrudan senkronize edilmez
 * (SYNC_PROTOCOL §2). Yalnızca hareket uygulanınca güncellenir.
 */
final class StockRepository
{
    public function __construct(
        private readonly Db $db,
        private readonly string $tenantId,
    ) {}

    public function getQty(string $partId, string $locationId): float
    {
        $row = $this->db->one(
            'SELECT qty FROM stock WHERE tenant_id = :tid AND part_id = :pid AND location_id = :lid',
            ['tid' => $this->tenantId, 'pid' => $partId, 'lid' => $locationId]
        );
        return $row === null ? 0.0 : (float) $row['qty'];
    }

    /**
     * Sayım (audit) için kilitli okuma: satır, okuma→güncelleme arası KİLİTLİ kalır.
     * Kilitsiz okumayla iki eşzamanlı sayım aynı delta'yı türetip düzeltmeyi çift uygular
     * (10→7 sayımı iki cihazdan gelirse sonuç 7 değil 4 olurdu). SQLite'ta (test) FOR UPDATE
     * yok ama dosya kilidi zaten yazmaları serileştirir.
     */
    public function getQtyForUpdate(string $partId, string $locationId): float
    {
        $sql = 'SELECT qty FROM stock WHERE tenant_id = :tid AND part_id = :pid AND location_id = :lid';
        if ($this->db->isMysql()) {
            $sql .= ' FOR UPDATE';
        }
        $row = $this->db->one($sql, ['tid' => $this->tenantId, 'pid' => $partId, 'lid' => $locationId]);
        return $row === null ? 0.0 : (float) $row['qty'];
    }

    /** exact mod: qty += delta (delta'lar toplanabilir — SYNC_PROTOCOL §1). */
    public function applyDelta(string $partId, string $locationId, float $delta, string $atMysql): void
    {
        $existing = $this->db->one(
            'SELECT id FROM stock WHERE tenant_id = :tid AND part_id = :pid AND location_id = :lid',
            ['tid' => $this->tenantId, 'pid' => $partId, 'lid' => $locationId]
        );
        $now = Time::now();
        if ($existing === null) {
            $this->db->run(
                'INSERT INTO stock (id, tenant_id, part_id, location_id, qty, last_move_at, updated_at)
                 VALUES (:id, :tid, :pid, :lid, :qty, :at, :now)',
                ['id' => Uuid::v7(), 'tid' => $this->tenantId, 'pid' => $partId, 'lid' => $locationId,
                 'qty' => $delta, 'at' => $atMysql, 'now' => $now]
            );
        } else {
            $this->db->run(
                'UPDATE stock SET qty = qty + :delta, last_move_at = :at, updated_at = :now
                  WHERE id = :id',
                ['delta' => $delta, 'at' => $atMysql, 'now' => $now, 'id' => $existing['id']]
            );
        }
    }

    /** level mod: durum (LWW by level_at — SYNC_PROTOCOL §6). */
    /** Doluluk sıralaması (eşit-zaman tiebreaker'ı): full > low > empty. */
    private static function levelRank(string $level): int
    {
        return match ($level) { 'full' => 3, 'low' => 2, 'empty' => 1, default => 0 };
    }

    public function setLevel(string $partId, string $locationId, string $level, string $atMysql): void
    {
        $existing = $this->db->one(
            'SELECT id, level, level_at, last_move_at FROM stock WHERE tenant_id = :tid AND part_id = :pid AND location_id = :lid',
            ['tid' => $this->tenantId, 'pid' => $partId, 'lid' => $locationId]
        );
        $now = Time::now();
        if ($existing === null) {
            $this->db->run(
                'INSERT INTO stock (id, tenant_id, part_id, location_id, qty, level, level_at, last_move_at, updated_at)
                 VALUES (:id, :tid, :pid, :lid, 0, :level, :at, :at2, :now)',
                ['id' => Uuid::v7(), 'tid' => $this->tenantId, 'pid' => $partId, 'lid' => $locationId,
                 'level' => $level, 'at' => $atMysql, 'at2' => $atMysql, 'now' => $now]
            );
            return;
        }

        $prevLevelAt = $existing['level_at'] !== null ? (string) $existing['level_at'] : null;
        // LWW: daha yeni olay kazanır. AYNI zaman damgasında (iki cihaz eşzamanlı
        // set etmişse) belirleyici tiebreaker: doluluk sıralaması (full>low>empty).
        // Her iki cihaz da AYNI kurala göre çözer → kalıcı ayrışma olmaz.
        $tie = $prevLevelAt !== null
            && !Time::gt($atMysql, $prevLevelAt) && !Time::gt($prevLevelAt, $atMysql)
            && self::levelRank($level) > self::levelRank((string) ($existing['level'] ?? ''));
        if ($prevLevelAt === null || Time::gt($atMysql, $prevLevelAt) || $tie) {
            $this->db->run(
                'UPDATE stock SET level = :level, level_at = :at, last_move_at = :at2, updated_at = :now
                  WHERE id = :id',
                ['level' => $level, 'at' => $atMysql, 'at2' => $atMysql, 'now' => $now, 'id' => $existing['id']]
            );
        } else {
            // Eski (sıra dışı) olay: level'i değiştirme; hareket zamanını yalnızca ileri al.
            $prevMoveAt = $existing['last_move_at'] !== null ? (string) $existing['last_move_at'] : null;
            $lastMoveAt = ($prevMoveAt === null || Time::gt($atMysql, $prevMoveAt)) ? $atMysql : $prevMoveAt;
            $this->db->run(
                'UPDATE stock SET last_move_at = :lm, updated_at = :now WHERE id = :id',
                ['lm' => $lastMoveAt, 'now' => $now, 'id' => $existing['id']]
            );
        }
    }

    /** Bootstrap için tüm stok görünümü. @return list<array<string,mixed>> */
    public function snapshot(): array
    {
        return $this->db->all(
            'SELECT id, part_id, location_id, qty, level, level_at, last_move_at, updated_at
               FROM stock WHERE tenant_id = :tid',
            ['tid' => $this->tenantId]
        );
    }
}
