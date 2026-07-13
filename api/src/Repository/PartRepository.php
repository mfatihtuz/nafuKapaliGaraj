<?php
declare(strict_types=1);

namespace Depo\Repository;

/** parts — katalog varlığı (LWW). Sütunlar db/schema.sql ile birebir. */
final class PartRepository extends BaseRepository
{
    protected function table(): string { return 'parts'; }

    protected function writableColumns(): array
    {
        return [
            'category_id', 'sku', 'name', 'mpn', 'manufacturer', 'attributes',
            'tags', 'count_mode', 'abc_class', 'min_qty', 'unit',
            'datasheet_url', 'photo_id', 'notes', 'deleted_at',
        ];
    }

    protected function jsonColumns(): array { return ['attributes']; }

    public function findBySku(string $sku): ?array
    {
        $row = $this->db->one(
            'SELECT * FROM parts WHERE tenant_id = :tid AND sku = :sku',
            ['tid' => $this->tenantId, 'sku' => $sku]
        );
        return $row === null ? null : $this->hydrate($row);
    }
}
