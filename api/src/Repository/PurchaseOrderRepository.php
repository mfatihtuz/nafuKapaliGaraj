<?php
declare(strict_types=1);

namespace Depo\Repository;

/**
 * purchase_orders — katalog varlığı (LWW, FAZ 3b 3.6). Bir satın alma siparişi:
 * tedarikçi (opsiyonel), durum (taslak/sipariş verildi/teslim alındı/iptal), toplam.
 * Teslim alma stoğu AYRI defterde (reason 'purchase', ref_id=po_item.id) — buradaki
 * total yalnızca özet/metadata.
 */
final class PurchaseOrderRepository extends BaseRepository
{
    protected function table(): string { return 'purchase_orders'; }

    protected function validateReferences(array $data): void
    {
        // Tedarikçi opsiyonel; verildiyse bu tenant'a ait olmalı (çapraz-tenant bağ savunması).
        $this->assertRefNotForeign('suppliers', $data['supplier_id'] ?? null, 'Tedarikçi bu organizasyona ait değil');
    }

    protected function writableColumns(): array
    {
        return [
            'supplier_id', 'status', 'ordered_at', 'received_at',
            'total', 'currency', 'note', 'deleted_at',
        ];
    }
}
