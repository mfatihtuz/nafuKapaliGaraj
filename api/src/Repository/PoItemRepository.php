<?php
declare(strict_types=1);

namespace Depo\Repository;

/**
 * po_items — katalog varlığı (LWW, FAZ 3b 3.6). Bir siparişin satırı.
 * part_id NULL = katalogda olmayan yeni parça (raw_name serbest metin). received_qty
 * teslim alındıkça artar (LWW). NOT: po_id sütununda HARD FK (fk_poi_po) var → sunucu,
 * PO satırı VARSA INSERT'e izin verir. Bu yüzden PO op'u po_item op'undan ÖNCE push edilmeli
 * (istemci ++seq sırasıyla garanti eder). Sütunlar db/schema.sql ile birebir.
 */
final class PoItemRepository extends BaseRepository
{
    protected function table(): string { return 'po_items'; }

    protected function validateReferences(array $data): void
    {
        // Çapraz-tenant bağ savunması: PO + (varsa) parça + hedef konum bu tenant'a ait olmalı.
        $this->assertRefNotForeign('purchase_orders', $data['po_id'] ?? null, 'Sipariş bu organizasyona ait değil');
        $this->assertRefNotForeign('parts', $data['part_id'] ?? null, 'Parça bu organizasyona ait değil');
        $this->assertRefNotForeign('locations', $data['target_location_id'] ?? null, 'Konum bu organizasyona ait değil');
    }

    protected function writableColumns(): array
    {
        return [
            'po_id', 'part_id', 'raw_name', 'qty', 'unit_price',
            'received_qty', 'target_location_id', 'deleted_at',
        ];
    }

    /** Bir siparişin aktif satırları (oluşum sırası). */
    public function forPo(string $poId): array
    {
        $rows = $this->db->all(
            'SELECT * FROM po_items WHERE tenant_id = :tid AND po_id = :p AND deleted_at IS NULL ORDER BY id',
            ['tid' => $this->tenantId, 'p' => $poId]
        );
        return array_map([$this, 'hydrate'], $rows);
    }
}
