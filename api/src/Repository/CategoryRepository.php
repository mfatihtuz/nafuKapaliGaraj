<?php
declare(strict_types=1);

namespace Depo\Repository;

/** categories — katalog varlığı (LWW). attribute_schema JSON. */
final class CategoryRepository extends BaseRepository
{
    protected function table(): string { return 'categories'; }

    protected function validateReferences(array $data): void
    {
        // Alt kategori, BAŞKA tenant'ın üst kategorisine bağlanamaz.
        $this->assertRefNotForeign('categories', $data['parent_id'] ?? null, 'Üst kategori bu organizasyona ait değil');
    }

    protected function writableColumns(): array
    {
        return [
            'parent_id', 'name_tr', 'name_en', 'code', 'attribute_schema',
            'sku_template', 'default_count_mode', 'sort_order', 'deleted_at',
        ];
    }

    protected function jsonColumns(): array { return ['attribute_schema']; }
}
