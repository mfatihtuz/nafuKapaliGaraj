<?php
declare(strict_types=1);

namespace Depo\Repository;

/**
 * part_suppliers — katalog varlığı (LWW, FAZ 3b). Bir parçanın bir tedarikçideki karşılığı:
 * tedarikçi SKU + ürün URL + son fiyat/para birimi/tarih.
 *
 * uq_ps UNIQUE(tenant, part, supplier): id İSTEMCİDE (part_id, supplier_id)'den DETERMİNİSTİK
 * türetilir (deterministicUuid). Böylece iki offline cihaz aynı (parça, tedarikçi) çifti için
 * AYNI id'yi üretir → lwwUpsert birleştirir; farklı rastgele id'ler UNIQUE ihlaliyle sonsuz
 * outbox'ta kalmaz. Repo tarafında ek koda gerek yok — lwwUpsert id üzerinden çalışır.
 */
final class PartSupplierRepository extends BaseRepository
{
    protected function table(): string { return 'part_suppliers'; }

    protected function validateReferences(array $data): void
    {
        $this->assertRefNotForeign('parts', $data['part_id'] ?? null, 'Parça bu organizasyona ait değil');
        $this->assertRefNotForeign('suppliers', $data['supplier_id'] ?? null, 'Tedarikçi bu organizasyona ait değil');
    }

    protected function writableColumns(): array
    {
        return [
            'part_id', 'supplier_id', 'supplier_sku', 'product_url',
            'last_price', 'currency', 'last_price_at', 'deleted_at',
        ];
    }
}
