<?php
declare(strict_types=1);

namespace Depo\Repository;

use Depo\Core\Db;

/**
 * change_log — tenant başına monoton artan değişiklik defteri (SYNC_PROTOCOL §4).
 * seq global AUTO_INCREMENT; sorgular tenant_id ile filtrelenir. Boşluk (gap) sorun değil.
 */
final class ChangeLogRepository
{
    public function __construct(
        private readonly Db $db,
        private readonly string $tenantId,
    ) {}

    /**
     * Bir değişikliği deftere ekler. payload = varlığın tam (kanonik) hali.
     * @param array<string,mixed> $payload
     * @return int Atanan seq
     */
    public function append(string $entity, string $entityId, string $op, array $payload, ?string $actorId): int
    {
        $this->db->run(
            'INSERT INTO change_log (tenant_id, entity, entity_id, op, payload, actor_id)
             VALUES (:tid, :entity, :eid, :op, :payload, :actor)',
            [
                'tid'     => $this->tenantId,
                'entity'  => $entity,
                'eid'     => $entityId,
                'op'      => $op,
                'payload' => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'actor'   => $actorId,
            ]
        );
        return (int) $this->db->pdo()->lastInsertId();
    }

    /**
     * since'den büyük değişiklikler (SYNC_PROTOCOL §5.2 pull).
     * @return array{changes:list<array<string,mixed>>,cursor:int,has_more:bool}
     */
    public function since(int $since, int $limit): array
    {
        $limit = max(1, min($limit, 1000));
        $rows = $this->db->all(
            'SELECT seq, entity, entity_id, op, payload
               FROM change_log
              WHERE tenant_id = :tid AND seq > :since
              ORDER BY seq ASC
              LIMIT ' . ($limit + 1),
            ['tid' => $this->tenantId, 'since' => $since]
        );

        $hasMore = count($rows) > $limit;
        if ($hasMore) {
            array_pop($rows);
        }

        $cursor = $since;
        $changes = [];
        foreach ($rows as $r) {
            $cursor = (int) $r['seq'];
            $changes[] = [
                'seq'       => (int) $r['seq'],
                'entity'    => $r['entity'],
                'entity_id' => $r['entity_id'],
                'op'        => $r['op'],
                'payload'   => json_decode((string) $r['payload'], true),
            ];
        }

        return ['changes' => $changes, 'cursor' => $cursor, 'has_more' => $hasMore];
    }

    /** Tenant için mevcut en yüksek seq (cursor). */
    public function maxSeq(): int
    {
        $row = $this->db->one(
            'SELECT MAX(seq) AS m FROM change_log WHERE tenant_id = :tid',
            ['tid' => $this->tenantId]
        );
        return (int) ($row['m'] ?? 0);
    }
}
