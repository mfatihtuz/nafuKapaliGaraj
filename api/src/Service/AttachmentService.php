<?php
declare(strict_types=1);

namespace Depo\Service;

use Depo\Core\Db;
use Depo\Core\HttpException;
use Depo\Core\Uuid;
use Depo\Repository\AttachmentRepository;
use Depo\Repository\ChangeLogRepository;

/**
 * Foto/PDF ek yükleme + servis (FAZ 2.1). CLAUDE.md §6:
 *  - Dosyalar webroot DIŞI (config['storage']['path']).
 *  - Erişim yalnızca tenant_id kontrollü PHP endpoint'iyle.
 *  - Foto DAİMA JPEG'e yeniden kodlanır (EXIF strip = gizlilik + boyut); thumb üretilir.
 *  - mime GERÇEK içerikten (finfo) tespit edilir; istemcinin verdiği tür güvenilmez.
 *  - sha256 = ham baytların özeti → tenant-içi bayt-dedup (diskte tek kopya).
 * Metadata bir KATALOG varlığı gibi change_log'a yazılır (sync ile diğer cihazlara akar).
 */
final class AttachmentService
{
    private const MAIN_EDGE = 1600;   // ana görüntü en uzun kenar
    private const THUMB_EDGE = 320;   // önizleme en uzun kenar
    private const JPEG_Q = 82;

    private AttachmentRepository $repo;
    private ChangeLogRepository $changeLog;

    public function __construct(
        private readonly Db $db,
        private readonly string $tenantId,
        private readonly ?string $actorId,
        private readonly array $config,
    ) {
        $this->repo = new AttachmentRepository($db, $tenantId);
        $this->changeLog = new ChangeLogRepository($db, $tenantId);
    }

    /** İzin verilen kaynak mime → kind eşlemesi. SVG bilinçli reddedilir (XSS). */
    private const MIME_KIND = [
        'image/jpeg' => 'photo',
        'image/png'  => 'photo',
        'image/webp' => 'photo',
        'application/pdf' => 'pdf',
    ];

    private function storageBase(): string
    {
        $p = $this->config['storage']['path'] ?? '';
        if (!is_string($p) || $p === '') {
            throw HttpException::unprocessable('Depolama yapılandırılmamış');
        }
        return rtrim($p, '/');
    }

    private function maxBytes(string $kind): int
    {
        $st = $this->config['storage'] ?? [];
        return $kind === 'pdf'
            ? (int) ($st['max_pdf_bytes'] ?? 20 * 1024 * 1024)
            : (int) ($st['max_photo_bytes'] ?? 10 * 1024 * 1024);
    }

    /**
     * Ham dosya baytlarını doğrular, işler, depolar ve metadata satırı + change_log yazar.
     * @return array<string,mixed> kanonik attachment satırı (istemci Dexie'ye yazar)
     */
    public function store(string $ownerType, string $ownerId, string $bytes, string $originalName): array
    {
        if (!in_array($ownerType, ['part', 'location'], true)) {
            throw HttpException::unprocessable('Geçersiz owner_type');
        }
        if (!Uuid::isValid($ownerId)) {
            throw HttpException::unprocessable('Geçersiz owner_id');
        }
        if ($bytes === '') {
            throw HttpException::badRequest('Boş dosya');
        }

        // GERÇEK mime (istemci type'ı değil).
        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        $mime = (string) $finfo->buffer($bytes);
        if (!isset(self::MIME_KIND[$mime])) {
            throw HttpException::unprocessable('Desteklenmeyen dosya türü: ' . $mime);
        }
        $kind = self::MIME_KIND[$mime];

        if (strlen($bytes) > $this->maxBytes($kind)) {
            throw HttpException::unprocessable('Dosya çok büyük');
        }

        $sha = hash('sha256', $bytes);
        $ext = $kind === 'pdf' ? '.pdf' : '.jpg';

        // Metadata + depolama tek transaction'da (row + change_log tutarlı).
        return $this->db->transaction(function () use ($ownerType, $ownerId, $kind, $mime, $sha, $ext, $bytes, $originalName): array {
            $width = null;
            $height = null;
            $storeMime = $mime;
            $mainBytes = $bytes;
            $thumbBytes = null;

            if ($kind === 'photo') {
                $main = $this->processImage($bytes, self::MAIN_EDGE);
                $mainBytes = $main['bytes'];
                $width = $main['width'];
                $height = $main['height'];
                $storeMime = 'image/jpeg';
                $thumbBytes = $this->processImage($bytes, self::THUMB_EDGE)['bytes'];
            }

            // Bayt-dedup: aynı sha daha önce yüklendiyse dosyayı YENİDEN yazma.
            $rel = $this->tenantId . '/' . substr($sha, 0, 2) . '/' . $sha . $ext;
            $thumbRel = $kind === 'photo' ? ($this->tenantId . '/' . substr($sha, 0, 2) . '/' . $sha . '_thumb.jpg') : null;
            $existing = $this->repo->findBySha($sha);
            if ($existing === null) {
                $this->writeFile($rel, $mainBytes);
                if ($thumbRel !== null && $thumbBytes !== null) {
                    $this->writeFile($thumbRel, $thumbBytes);
                }
            } else {
                // Diskteki yol/piksel bilgisini yeniden kullan (aynı kaynak baytlar).
                $rel = (string) $existing['storage_path'];
                $thumbRel = $existing['thumb_path'] !== null ? (string) $existing['thumb_path'] : $thumbRel;
                $width = $existing['width'] !== null ? (int) $existing['width'] : $width;
                $height = $existing['height'] !== null ? (int) $existing['height'] : $height;
            }

            $sort = $this->repo->maxSortOrder($ownerType, $ownerId) + 10;
            $now = \Depo\Support\Time::now();
            $data = [
                'id'           => Uuid::v7(),
                'owner_type'   => $ownerType,
                'owner_id'     => $ownerId,
                'kind'         => $kind,
                'filename'     => mb_substr($this->safeName($originalName), 0, 255),
                'mime'         => $storeMime,
                'size_bytes'   => strlen($mainBytes),
                'sha256'       => $sha,
                'width'        => $width,
                'height'       => $height,
                'storage_path' => $rel,
                'thumb_path'   => $thumbRel,
                'sort_order'   => $sort,
                'updated_at'   => $now,
            ];
            $row = $this->repo->lwwUpsert($data);
            $this->changeLog->append('attachment', (string) $row['id'], 'upsert', $row, $this->actorId);
            return $row;
        });
    }

    /**
     * İndirme için mutlak dosya yolu + mime döndürür (tenant kontrollü).
     * @return array{path:string,mime:string,sha:string}
     */
    public function fileFor(string $id, bool $thumb): array
    {
        $row = $this->repo->findById($id); // tenant-scope'lu
        if ($row === null || $row['deleted_at'] !== null) {
            throw HttpException::notFound('Ek bulunamadı');
        }
        $rel = $thumb && $row['thumb_path'] !== null ? (string) $row['thumb_path'] : (string) $row['storage_path'];
        $mime = $thumb && $row['thumb_path'] !== null ? 'image/jpeg' : (string) $row['mime'];
        $abs = $this->storageBase() . '/' . $rel;
        if (!is_file($abs)) {
            throw HttpException::notFound('Dosya diskte yok');
        }
        return ['path' => $abs, 'mime' => $mime, 'sha' => (string) $row['sha256']];
    }

    // --- iç yardımcılar -----------------------------------------------------

    /** GD ile en uzun kenarı $maxEdge'e indirger, JPEG döndürür. EXIF strip'lenir. */
    private function processImage(string $bytes, int $maxEdge): array
    {
        $img = @imagecreatefromstring($bytes);
        if ($img === false) {
            throw HttpException::unprocessable('Görsel çözümlenemedi');
        }
        $w = imagesx($img);
        $h = imagesy($img);
        $scale = min(1.0, $maxEdge / max(1, max($w, $h)));
        $nw = max(1, (int) round($w * $scale));
        $nh = max(1, (int) round($h * $scale));
        if ($scale < 1.0) {
            $resized = imagescale($img, $nw, $nh);
            if ($resized !== false) {
                imagedestroy($img);
                $img = $resized;
            }
        }
        $nw = imagesx($img);
        $nh = imagesy($img);
        ob_start();
        imagejpeg($img, null, self::JPEG_Q);
        $out = (string) ob_get_clean();
        imagedestroy($img);
        return ['bytes' => $out, 'width' => $nw, 'height' => $nh];
    }

    private function writeFile(string $rel, string $data): void
    {
        $abs = $this->storageBase() . '/' . $rel;
        $dir = dirname($abs);
        if (!is_dir($dir)) {
            @mkdir($dir, 0700, true);
        }
        if (is_file($abs)) {
            return; // dedup: zaten var
        }
        $tmp = $abs . '.tmp' . bin2hex(random_bytes(4));
        if (file_put_contents($tmp, $data) === false) {
            throw HttpException::unprocessable('Dosya yazılamadı');
        }
        @chmod($tmp, 0640);
        rename($tmp, $abs); // atomik
    }

    /** Dosya adını güvene alır (path traversal / kontrol karakteri temizliği). */
    private function safeName(string $name): string
    {
        $name = basename($name);
        $name = preg_replace('/[\x00-\x1F\x7F]/', '', $name) ?? '';
        return $name === '' ? 'dosya' : $name;
    }
}
