<?php
declare(strict_types=1);

namespace Depo\Repository;

use Depo\Core\Db;

/**
 * sync_ops — idempotency kaydı (SYNC_PROTOCOL §5.3).
 * Aynı op_id iki kez uygulanmaz. Test 2 ve Test 5'in temeli.
 */
final class SyncOpRepository
{
    public function __construct(
        private readonly Db $db,
        private readonly string $tenantId,
    ) {}

    public function exists(string $opId): bool
    {
        $row = $this->db->one('SELECT 1 AS x FROM sync_ops WHERE op_id = :id', ['id' => $opId]);
        return $row !== null;
    }

    /** Uygulanmış olarak işaretle. Effect ile AYNI transaction içinde çağrılmalı. */
    public function record(string $opId): void
    {
        $this->db->run(
            'INSERT INTO sync_ops (op_id, tenant_id) VALUES (:id, :tid)',
            ['id' => $opId, 'tid' => $this->tenantId]
        );
    }
}
