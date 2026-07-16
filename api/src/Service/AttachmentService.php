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
    // Decode ÖNCESİ piksel tavanı: bayt sınırı (10MB) piksel sayısını bağlamaz;
    // 10MB'lık bir JPEG 40-50 MP olabilir ve GD truecolor tamponu ~piksel*4 bayt
    // ister (48MP≈192MB) → paylaşımlı hostingde memory_limit fatal'ı (yakalanamaz).
    private const MAX_PIXELS = 40_000_000; // 40 MP

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
     * @param string|null $clientId İstemcinin PendingUpload.id'si (varsa). Attachment PK'sı
     *   olarak kullanılır → aynı yüklemenin tekrarı (timeout/reload sonrası) İDEMPOTENT
     *   olur (lwwUpsert yerinde günceller, ikinci satır oluşmaz).
     * @return array<string,mixed> kanonik attachment satırı (istemci Dexie'ye yazar)
     */
    public function store(string $ownerType, string $ownerId, string $bytes, string $originalName, ?string $clientId = null): array
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
        // Sahip DOĞRULAMASI diske yazmadan ÖNCE (yetim dosya savunması): sahip parça/konum
        // bu tenant'ta VAR olmalı. Aksi hâlde geçerli bir foto çapraz-tenant owner_id ile
        // yollanıp disk dolduramaz (dosya yazıldıktan sonra lwwUpsert reddederse rollback
        // DB'yi geri alır ama diski değil). Bkz. inceleme bulgusu #9.
        $this->assertOwnerOwned($ownerType, $ownerId);

        // İstemci id'si verildiyse geçerli UUID olmalı (idempotency anahtarı, PK).
        if ($clientId !== null && $clientId !== '' && !Uuid::isValid($clientId)) {
            throw HttpException::unprocessable('Geçersiz ek id');
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

        // Foto için piksel tavanını DECODE'dan önce uygula (memory_limit bombası savunması).
        if ($kind === 'photo') {
            $dim = @getimagesizefromstring($bytes);
            if ($dim === false) {
                throw HttpException::unprocessable('Görsel çözümlenemedi');
            }
            if ((int) $dim[0] * (int) $dim[1] > self::MAX_PIXELS) {
                throw HttpException::unprocessable('Görsel çözünürlüğü çok yüksek (en fazla 40 MP)');
            }
        }

        $sha = hash('sha256', $bytes);
        $ext = $kind === 'pdf' ? '.pdf' : '.jpg';

        // Metadata + depolama tek transaction'da (row + change_log tutarlı).
        return $this->db->transaction(function () use ($ownerType, $ownerId, $kind, $mime, $sha, $ext, $bytes, $originalName, $clientId): array {
            $width = null;
            $height = null;
            $storeMime = $mime;
            $mainBytes = $bytes;
            $thumbBytes = null;

            if ($kind === 'photo') {
                // TEK decode: main üretilir, thumb main'in KÜÇÜLTÜLMÜŞ resource'undan türetilir
                // (orijinali ikinci kez decode etmez → tepe bellek katlanmaz — bulgu #5).
                $pair = $this->processPhoto($bytes);
                $mainBytes = $pair['main'];
                $width = $pair['width'];
                $height = $pair['height'];
                $thumbBytes = $pair['thumb'];
                $storeMime = 'image/jpeg';
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
                // İstemci id'si (idempotency) yoksa sunucu üretir.
                'id'           => ($clientId !== null && $clientId !== '') ? $clientId : Uuid::v7(),
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

    /** Sahip parça/konum bu tenant'ta VAR mı? (Upload öncesi katı doğrulama.) */
    private function assertOwnerOwned(string $ownerType, string $ownerId): void
    {
        $table = $ownerType === 'part' ? 'parts' : 'locations';
        $row = $this->db->one(
            "SELECT tenant_id FROM {$table} WHERE id = :id AND deleted_at IS NULL",
            ['id' => $ownerId]
        );
        if ($row === null || (string) $row['tenant_id'] !== $this->tenantId) {
            throw HttpException::unprocessable('Ek eklenecek kayıt bulunamadı');
        }
    }

    /**
     * İndirme için mutlak dosya yolu + mime döndürür (tenant kontrollü + yol-sınırlı).
     * @return array{path:string,mime:string,sha:string,kind:string,filename:string}
     */
    public function fileFor(string $id, bool $thumb): array
    {
        $row = $this->repo->findById($id); // tenant-scope'lu
        if ($row === null || $row['deleted_at'] !== null) {
            throw HttpException::notFound('Ek bulunamadı');
        }
        $rel = $thumb && $row['thumb_path'] !== null ? (string) $row['thumb_path'] : (string) $row['storage_path'];
        $mime = $thumb && $row['thumb_path'] !== null ? 'image/jpeg' : (string) $row['mime'];
        $base = $this->storageBase();
        $abs = $base . '/' . $rel;
        // GÜVENLİK (kritik — bulgu #1): storage_path'in depolama kökünün DIŞINA çıkmadığını
        // realpath ile doğrula. Savunma-derinliği: sync upsert reddi (SyncService) birincil
        // savunma; bu ikinci kapı, kökün dışına işaret eden herhangi bir yolu (ör. '../config.php',
        // '../../etc/passwd') hard-fail eder. realpath sembolik bağ/'..' çözer.
        $realBase = realpath($base);
        $realAbs = realpath($abs);
        if ($realBase === false || $realAbs === false || !str_starts_with($realAbs, $realBase . DIRECTORY_SEPARATOR)) {
            throw HttpException::notFound('Dosya bulunamadı');
        }
        if (!is_file($realAbs)) {
            throw HttpException::notFound('Dosya diskte yok');
        }
        return ['path' => $realAbs, 'mime' => $mime, 'sha' => (string) $row['sha256'], 'kind' => (string) $row['kind'], 'filename' => (string) $row['filename']];
    }

    // --- iç yardımcılar -----------------------------------------------------

    /**
     * Fotoğrafı TEK decode ile işler: main (≤MAIN_EDGE) + thumb (≤THUMB_EDGE) JPEG üretir.
     * Thumb, orijinali yeniden decode etmek yerine küçültülmüş main resource'undan türetilir
     * → tepe bellek katlanmaz (bulgu #5). EXIF, yeniden kodlamayla strip'lenir.
     * @return array{main:string,thumb:string,width:int,height:int}
     */
    private function processPhoto(string $bytes): array
    {
        $src = @imagecreatefromstring($bytes);
        if ($src === false) {
            throw HttpException::unprocessable('Görsel çözümlenemedi');
        }
        try {
            $main = $this->scaleToEdge($src, self::MAIN_EDGE);
            $mainBytes = $this->encodeJpeg($main);
            $mw = imagesx($main);
            $mh = imagesy($main);
            // Thumb'ı MAIN'den küçült (orijinal $src'yi tekrar kullanmadan).
            $thumb = $this->scaleToEdge($main, self::THUMB_EDGE);
            $thumbBytes = $this->encodeJpeg($thumb);
            if ($thumb !== $main) {
                imagedestroy($thumb);
            }
            imagedestroy($main);
            return ['main' => $mainBytes, 'thumb' => $thumbBytes, 'width' => $mw, 'height' => $mh];
        } finally {
            imagedestroy($src);
        }
    }

    /** Bir GD görüntüsünü en uzun kenarı $maxEdge olacak şekilde ölçekler (küçültme only). */
    private function scaleToEdge(\GdImage $img, int $maxEdge): \GdImage
    {
        $w = imagesx($img);
        $h = imagesy($img);
        $scale = min(1.0, $maxEdge / max(1, max($w, $h)));
        if ($scale >= 1.0) {
            return $img; // zaten yeterince küçük — aynı resource'u döndür
        }
        $nw = max(1, (int) round($w * $scale));
        $nh = max(1, (int) round($h * $scale));
        $resized = imagescale($img, $nw, $nh);
        return $resized === false ? $img : $resized;
    }

    /** GD görüntüsünü JPEG bayt dizisine kodlar. */
    private function encodeJpeg(\GdImage $img): string
    {
        ob_start();
        imagejpeg($img, null, self::JPEG_Q);
        return (string) ob_get_clean();
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
