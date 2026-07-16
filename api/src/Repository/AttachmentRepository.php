<?php
declare(strict_types=1);

namespace Depo\Repository;

/**
 * attachments — katalog varlığı (LWW). Parça/konum foto+PDF ekinin METADATA'sı.
 * İkili DOSYA burada tutulmaz (webroot-dışı storage_path); yalnızca metadata
 * senkronize olur (SYNC_PROTOCOL §2A). Sütunlar db/schema.sql ile birebir.
 */
final class AttachmentRepository extends BaseRepository
{
    protected function table(): string { return 'attachments'; }

    protected function validateReferences(array $data): void
    {
        // Ek, BAŞKA tenant'ın parça/konumuna bağlanamaz (polimorfik sahiplik savunması).
        $type = $data['owner_type'] ?? null;
        if ($type === 'part') {
            $this->assertRefNotForeign('parts', $data['owner_id'] ?? null, 'Parça bu organizasyona ait değil');
        } elseif ($type === 'location') {
            $this->assertRefNotForeign('locations', $data['owner_id'] ?? null, 'Konum bu organizasyona ait değil');
        }
    }

    protected function writableColumns(): array
    {
        return [
            'owner_type', 'owner_id', 'kind', 'filename', 'mime', 'size_bytes',
            'sha256', 'width', 'height', 'storage_path', 'thumb_path', 'sort_order', 'deleted_at',
        ];
    }

    /** Aynı tenant'ta bu sha256 daha önce yüklendiyse dosya yolunu döndürür (bayt-dedup). */
    public function findBySha(string $sha256): ?array
    {
        $row = $this->db->one(
            'SELECT * FROM attachments WHERE tenant_id = :tid AND sha256 = :s AND storage_path <> \'\' LIMIT 1',
            ['tid' => $this->tenantId, 's' => $sha256]
        );
        return $row === null ? null : $this->hydrate($row);
    }

    /** Bir sahibin (parça/konum) aktif eklerini sort_order sırasıyla döndürür. */
    public function forOwner(string $ownerType, string $ownerId): array
    {
        $rows = $this->db->all(
            'SELECT * FROM attachments WHERE tenant_id = :tid AND owner_type = :t AND owner_id = :o '
            . 'AND deleted_at IS NULL ORDER BY sort_order, created_at',
            ['tid' => $this->tenantId, 't' => $ownerType, 'o' => $ownerId]
        );
        return array_map([$this, 'hydrate'], $rows);
    }

    /** Bir sahipteki en yüksek sort_order (yeni ek sona eklenir). */
    public function maxSortOrder(string $ownerType, string $ownerId): int
    {
        $row = $this->db->one(
            'SELECT MAX(sort_order) AS m FROM attachments WHERE tenant_id = :tid AND owner_type = :t AND owner_id = :o AND deleted_at IS NULL',
            ['tid' => $this->tenantId, 't' => $ownerType, 'o' => $ownerId]
        );
        return (int) ($row['m'] ?? 0);
    }
}
