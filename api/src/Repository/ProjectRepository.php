<?php
declare(strict_types=1);

namespace Depo\Repository;

/**
 * projects — katalog varlığı (LWW, FAZ 3a). Bir proje = plan verisi (ad/durum/notlar)
 * + sanal konum bağı (location_id → type='project' bir locations satırı). Çekilen
 * parçalar o konuma taşınır; stok/defter mevcut altyapıyı kullanır (yeni stok tablosu YOK).
 * Sütunlar db/schema.sql ile birebir.
 */
final class ProjectRepository extends BaseRepository
{
    protected function table(): string { return 'projects'; }

    protected function validateReferences(array $data): void
    {
        // Proje, BAŞKA tenant'ın konumuna bağlanamaz (sanal konum izolasyonu).
        $this->assertRefNotForeign('locations', $data['location_id'] ?? null, 'Konum bu organizasyona ait değil');
    }

    protected function writableColumns(): array
    {
        return ['name', 'status', 'location_id', 'notes', 'deleted_at'];
    }
}
