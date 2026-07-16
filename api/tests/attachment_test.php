<?php
declare(strict_types=1);

/**
 * FAZ 2.1 — Ek (foto/PDF) testleri: AttachmentService (GD/dedup/tenant izolasyonu)
 * + attachment metadata senkronizasyonu (bootstrap/pull/push-delete/idempotency).
 * Çalıştır: php api/tests/attachment_test.php
 */

require __DIR__ . '/bootstrap.php';

use Depo\Core\Uuid;
use Depo\Service\AttachmentService;
use Depo\Service\SyncService;
use Depo\Support\Time;

/** Bellekte gerçek bir JPEG üret (GD ile). */
function make_jpeg(int $w = 800, int $h = 600): string
{
    $im = imagecreatetruecolor($w, $h);
    imagefilledrectangle($im, 0, 0, $w, $h, imagecolorallocate($im, 120, 60, 200));
    ob_start();
    imagejpeg($im, null, 90);
    $b = (string) ob_get_clean();
    imagedestroy($im);
    return $b;
}

$tmpStore = sys_get_temp_dir() . '/depo_att_' . bin2hex(random_bytes(4));
$config = ['storage' => ['path' => $tmpStore], 'app' => ['env' => 'testing']];

[$db] = make_test_db();
$A = seed_tenant($db, 'Atolye A');
$B = seed_tenant($db, 'Atolye B');

// Sahip olacak parça (tenant A)
$partId = Uuid::v7();
$db->run(
    'INSERT INTO parts (id, tenant_id, sku, name, updated_at) VALUES (:id,:t,:s,:n,:u)',
    ['id' => $partId, 't' => $A['tenant_id'], 's' => 'R-1', 'n' => 'Direnç', 'u' => Time::now()]
);

$svcA = new AttachmentService($db, $A['tenant_id'], $A['user_id'], $config);

// --- 1) Foto yükleme + işleme ---
$jpeg = make_jpeg(2000, 1500); // MAIN_EDGE (1600) üstünde → küçültülmeli
$row = $svcA->store('part', $partId, $jpeg, 'ornek.jpg');
check($row['kind'] === 'photo', '1 kind=photo');
check(strlen((string) $row['sha256']) === 64, '2 sha256 64 hex');
check($row['mime'] === 'image/jpeg', '3 mime image/jpeg (yeniden kodlandı)');
check((int) $row['width'] <= 1600 && (int) $row['height'] <= 1600, '4 en uzun kenar <=1600 (küçültüldü)');
check($row['thumb_path'] !== null, '5 thumbnail üretildi');
$absMain = $tmpStore . '/' . $row['storage_path'];
$absThumb = $tmpStore . '/' . $row['thumb_path'];
check(is_file($absMain), '6 ana dosya diske yazıldı');
check(is_file($absThumb), '7 thumbnail diske yazıldı');
check(filesize($absMain) < strlen($jpeg) + 1, '8 işlenmiş dosya makul boyutta');

// --- 2) Dedup: aynı bayt, farklı sahip → 2 satır, TEK disk kopyası ---
$locId = Uuid::v7();
$db->run(
    'INSERT INTO locations (id, tenant_id, code, path, updated_at) VALUES (:id,:t,:c,:p,:u)',
    ['id' => $locId, 't' => $A['tenant_id'], 'c' => 'S1-01', 'p' => 'GARAJ/S1/S1-01', 'u' => Time::now()]
);
$row2 = $svcA->store('location', $locId, $jpeg, 'ayni.jpg');
check($row2['id'] !== $row['id'], '9 dedup: ikinci ek ayrı satır');
check($row2['sha256'] === $row['sha256'], '10 dedup: aynı sha256');
check($row2['storage_path'] === $row['storage_path'], '11 dedup: aynı disk yolu (tek bayt kopyası)');

// --- 3) Desteklenmeyen tür reddi ---
$rejected = false;
try {
    $svcA->store('part', $partId, 'düz metin dosyası', 'not.txt');
} catch (\Depo\Core\HttpException $e) {
    $rejected = true;
}
check($rejected, '12 metin/desteklenmeyen tür reddedildi');

// --- 4) Tenant izolasyonu: B, A'nın ekini indiremez ---
$svcB = new AttachmentService($db, $B['tenant_id'], $B['user_id'], $config);
$leak = false;
try {
    $svcB->fileFor((string) $row['id'], false);
} catch (\Depo\Core\HttpException $e) {
    $leak = true; // notFound bekleniyor
}
check($leak, '13 tenant izolasyonu: başka tenant ekini indiremez (404)');
// A kendi ekini indirebilir
$f = $svcA->fileFor((string) $row['id'], true); // thumb
check(is_file($f['path']) && $f['mime'] === 'image/jpeg', '14 sahip thumbnail indirir');

// --- 5) Sync: bootstrap attachments içerir + change_log akışı ---
$syncA = new SyncService($db, $A['tenant_id'], $A['user_id']);
$boot = $syncA->bootstrap();
check(isset($boot['attachments']) && is_array($boot['attachments']), '15 bootstrap attachments alanı var');
check(count($boot['attachments']) === 2, '16 bootstrap 2 aktif ek döndürür');
$pull = $syncA->pull(0, 500);
$attChanges = array_filter($pull['changes'], fn ($c) => ($c['entity'] ?? '') === 'attachment');
check(count($attChanges) >= 2, '17 pull change-feed attachment upsert taşır');

// --- 6) Push ile SİLME (çevrimdışı-uyumlu) + idempotency ---
usleep(3000); // silme updated_at'i store'dan sonra olsun (LWW)
$delOp = ['op_id' => Uuid::v7(), 'type' => 'delete', 'entity' => 'attachment',
    'data' => ['id' => $row['id'], 'updated_at' => Time::now()]];
$r1 = $syncA->push([$delOp]);
check(in_array($row['id'], array_map(fn ($x) => $x, $r1['applied'])) || count($r1['applied']) === 1, '18 delete op uygulandı');
$after = $db->one('SELECT deleted_at FROM attachments WHERE id = :id', ['id' => $row['id']]);
check($after !== null && $after['deleted_at'] !== null, '19 ek soft-delete edildi');
// Idempotency: aynı op tekrar → tek silme, hata yok
$r2 = $syncA->push([$delOp]);
check(count($r2['applied']) === 1 && count($r2['rejected']) === 0, '20 aynı delete op idempotent');
$boot2 = $syncA->bootstrap();
check(count($boot2['attachments']) === 1, '21 silme sonrası bootstrap 1 aktif ek');

// --- 7) Başka tenant'ın sahibine ek reddi (polimorfik sahiplik) ---
$foreign = false;
try {
    // A, B'nin parçasına ek eklemeye çalışsa validateReferences yakalar; burada
    // A tenant'ında OLMAYAN bir owner_id ile lwwUpsert dolaylı test edilir:
    $bPart = Uuid::v7();
    $db->run('INSERT INTO parts (id, tenant_id, sku, name, updated_at) VALUES (:id,:t,:s,:n,:u)',
        ['id' => $bPart, 't' => $B['tenant_id'], 's' => 'X', 'n' => 'X', 'u' => Time::now()]);
    $svcA->store('part', $bPart, make_jpeg(100, 100), 'x.jpg');
} catch (\Depo\Core\HttpException $e) {
    $foreign = true;
}
check($foreign, '22 başka tenant parçasına ek reddedildi (izolasyon)');

// temizlik
if (is_dir($tmpStore)) {
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($tmpStore, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($it as $p) { $p->isDir() ? @rmdir($p->getPathname()) : @unlink($p->getPathname()); }
    @rmdir($tmpStore);
}

exit(test_summary());
