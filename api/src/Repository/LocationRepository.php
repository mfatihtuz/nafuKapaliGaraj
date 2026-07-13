<?php
declare(strict_types=1);

namespace Depo\Repository;

/** locations — katalog varlığı (LWW). Konum kodu asla değişmez (PHYSICAL_LAYOUT §1). */
final class LocationRepository extends BaseRepository
{
    protected function table(): string { return 'locations'; }

    protected function writableColumns(): array
    {
        return [
            'parent_id', 'code', 'name', 'type', 'path',
            'photo_id', 'capacity_note', 'sort_order', 'deleted_at',
        ];
    }

    public function findByCode(string $code): ?array
    {
        $row = $this->db->one(
            'SELECT * FROM locations WHERE tenant_id = :tid AND code = :code',
            ['tid' => $this->tenantId, 'code' => $code]
        );
        return $row === null ? null : $this->hydrate($row);
    }
}
