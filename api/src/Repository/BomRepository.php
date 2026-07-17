<?php
declare(strict_types=1);

namespace Depo\Repository;

/**
 * bom_items — katalog varlığı (LWW, FAZ 3a). Bir projenin malzeme listesi satırı.
 * part_id NULL = henüz eşleşmemiş ham satır (KiCad değer/paket/mpn'i raw_* alanlarında).
 * NOT: project_id sütununda HARD FK (fk_bom_proj) var → sunucu, proje satırı VARSA
 * INSERT'e izin verir. Bu yüzden proje op'u bom_item op'undan ÖNCE push edilmeli
 * (istemci ++seq sırasıyla garanti eder). Sütunlar db/schema.sql ile birebir.
 */
final class BomRepository extends BaseRepository
{
    protected function table(): string { return 'bom_items'; }

    protected function validateReferences(array $data): void
    {
        // Çapraz-tenant bağ savunması: proje ve (varsa) parça bu tenant'a ait olmalı.
        $this->assertRefNotForeign('projects', $data['project_id'] ?? null, 'Proje bu organizasyona ait değil');
        $this->assertRefNotForeign('parts', $data['part_id'] ?? null, 'Parça bu organizasyona ait değil');
    }

    protected function writableColumns(): array
    {
        return [
            'project_id', 'part_id', 'raw_ref', 'raw_value', 'raw_footprint',
            'raw_mpn', 'qty_needed', 'note', 'sort_order', 'deleted_at',
        ];
    }

    /** Bir projenin aktif BOM satırları (sıra + oluşum). */
    public function forProject(string $projectId): array
    {
        $rows = $this->db->all(
            'SELECT * FROM bom_items WHERE tenant_id = :tid AND project_id = :p AND deleted_at IS NULL '
            . 'ORDER BY sort_order, id',
            ['tid' => $this->tenantId, 'p' => $projectId]
        );
        return array_map([$this, 'hydrate'], $rows);
    }
}
