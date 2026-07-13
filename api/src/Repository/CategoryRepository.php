<?php
declare(strict_types=1);

namespace Depo\Repository;

/** categories — katalog varlığı (LWW). attribute_schema JSON. */
final class CategoryRepository extends BaseRepository
{
    protected function table(): string { return 'categories'; }

    protected function writableColumns(): array
    {
        return [
            'parent_id', 'name_tr', 'name_en', 'code', 'attribute_schema',
            'sku_template', 'default_count_mode', 'sort_order', 'deleted_at',
        ];
    }

    protected function jsonColumns(): array { return ['attribute_schema']; }
}
