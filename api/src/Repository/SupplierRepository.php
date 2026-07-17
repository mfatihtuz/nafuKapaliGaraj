<?php
declare(strict_types=1);

namespace Depo\Repository;

/** suppliers — katalog varlığı (LWW, FAZ 3b). Tedarikçi (ad + web). FK yok. */
final class SupplierRepository extends BaseRepository
{
    protected function table(): string { return 'suppliers'; }

    protected function writableColumns(): array
    {
        return ['name', 'website', 'deleted_at'];
    }
}
