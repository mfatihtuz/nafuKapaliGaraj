<?php
declare(strict_types=1);

/**
 * SYNC_PROTOCOL §8 — zorunlu test senaryoları.
 * Çalıştır:  php api/tests/sync_test.php
 *
 * Test 3 (delta toplanabilirliği) ve Test 5 (idempotency) projenin tek kritik testidir.
 */

require __DIR__ . '/bootstrap.php';

use Depo\Core\Uuid;
use Depo\Service\SyncService;

/** Artan ISO8601 zaman damgası (LWW sıralaması için). */
function iso(int $offsetSec = 0): string
{
    return (new DateTimeImmutable("@" . (1_752_000_000 + $offsetSec)))
        ->format('Y-m-d\TH:i:s.v\Z');
}

function opUpsertPart(array $data): array
{
    return ['op_id' => Uuid::v7(), 'type' => 'upsert', 'entity' => 'part', 'data' => $data];
}
function opUpsertLocation(array $data): array
{
    return ['op_id' => Uuid::v7(), 'type' => 'upsert', 'entity' => 'location', 'data' => $data];
}
function opMove(string $partId, string $locId, float $delta, string $reason, string $when, ?string $opId = null): array
{
    return [
        'op_id' => $opId ?? Uuid::v7(),
        'type'  => 'stock_move',
        'data'  => ['id' => Uuid::v7(), 'part_id' => $partId, 'location_id' => $locId,
                    'delta' => $delta, 'reason' => $reason, 'created_at' => $when],
    ];
}

/** Bir part + location kurar (exact mod), id'leri döner. */
function scaffold(SyncService $svc, string $mode = 'exact'): array
{
    $partId = Uuid::v7();
    $locId  = Uuid::v7();
    $r = $svc->push([
        opUpsertLocation(['id' => $locId, 'code' => 'S1-07', 'type' => 'drawer',
            'path' => 'GARAJ/S1/S1-07', 'updated_at' => iso(0)]),
        opUpsertPart(['id' => $partId, 'sku' => 'R-0805-10K', 'name' => '10K direnç',
            'count_mode' => $mode, 'updated_at' => iso(0)]),
    ]);
    if (count($r['applied']) !== 2) {
        throw new RuntimeException('scaffold başarısız: ' . json_encode($r));
    }
    return ['part_id' => $partId, 'location_id' => $locId];
}

function currentQty(SyncService $svc, string $partId, string $locId): float
{
    foreach ($svc->bootstrap()['stock_snapshot'] as $s) {
        if ($s['part_id'] === $partId && $s['location_id'] === $locId) {
            return (float) $s['qty'];
        }
    }
    return 0.0;
}

// ===========================================================================

fwrite(STDOUT, "TEST 1 — 20 offline işlem, hiçbiri kaybolmaz\n");
{
    [$db] = make_test_db();
    $t = seed_tenant($db);
    $svc = new SyncService($db, $t['tenant_id'], $t['user_id']);
    $ids = scaffold($svc);
    $svc->push([opMove($ids['part_id'], $ids['location_id'], 100, 'initial', iso(1))]);

    $ops = [];
    for ($i = 0; $i < 20; $i++) {
        $ops[] = opMove($ids['part_id'], $ids['location_id'], -1, 'consume', iso(10 + $i));
    }
    $res = $svc->push($ops);
    eq(count($res['applied']), 20, '20 op uygulandı');
    eq(count($res['rejected']), 0, 'reddedilen yok');
    eq(currentQty($svc, $ids['part_id'], $ids['location_id']), 80.0, 'qty 100 - 20 = 80');
}

fwrite(STDOUT, "\nTEST 2 — aynı push 3 kez → stok bir kez değişir (idempotency)\n");
{
    [$db] = make_test_db();
    $t = seed_tenant($db);
    $svc = new SyncService($db, $t['tenant_id'], $t['user_id']);
    $ids = scaffold($svc);
    $svc->push([opMove($ids['part_id'], $ids['location_id'], 100, 'initial', iso(1))]);

    $op = opMove($ids['part_id'], $ids['location_id'], -1, 'consume', iso(5), Uuid::v7());
    $r1 = $svc->push([$op]);
    $r2 = $svc->push([$op]);   // ağ yeniden denemesi
    $r3 = $svc->push([$op]);   // yine
    eq(count($r1['applied']), 1, '1. push uygulandı');
    eq(count($r2['applied']), 1, '2. push da applied döner (idempotent)');
    eq(count($r3['applied']), 1, '3. push da applied döner');
    eq(currentQty($svc, $ids['part_id'], $ids['location_id']), 99.0, 'qty yalnızca bir kez düştü (100→99)');
}

fwrite(STDOUT, "\nTEST 3 ⭐ — A offline -3, B online -5 → sonuç -8\n");
{
    [$db] = make_test_db();
    $t = seed_tenant($db);
    $svc = new SyncService($db, $t['tenant_id'], $t['user_id']);
    $ids = scaffold($svc);
    $svc->push([opMove($ids['part_id'], $ids['location_id'], 100, 'initial', iso(1))]);

    // Cihaz B (online) önce -5 push eder
    $svc->push([opMove($ids['part_id'], $ids['location_id'], -5, 'consume', iso(20))]);
    // Cihaz A (offline'dı) sonra -3 push eder
    $svc->push([opMove($ids['part_id'], $ids['location_id'], -3, 'consume', iso(15))]);

    eq(currentQty($svc, $ids['part_id'], $ids['location_id']), 92.0, '100 - 5 - 3 = 92 (delta toplanabilir)');
}

fwrite(STDOUT, "\nTEST 4 — aynı parça iki cihazdan farklı isim → LWW, çökme yok\n");
{
    [$db] = make_test_db();
    $t = seed_tenant($db);
    $svc = new SyncService($db, $t['tenant_id'], $t['user_id']);
    $partId = Uuid::v7();
    $svc->push([opUpsertPart(['id' => $partId, 'sku' => 'X-1', 'name' => 'İlk',
        'count_mode' => 'exact', 'updated_at' => iso(0)])]);
    $svc->push([opUpsertPart(['id' => $partId, 'sku' => 'X-1', 'name' => 'İkinci (yeni)',
        'count_mode' => 'exact', 'updated_at' => iso(10)])]);
    $svc->push([opUpsertPart(['id' => $partId, 'sku' => 'X-1', 'name' => 'Eski (yok sayılmalı)',
        'count_mode' => 'exact', 'updated_at' => iso(5)])]);

    $part = null;
    foreach ($svc->bootstrap()['parts'] as $p) {
        if ($p['id'] === $partId) { $part = $p; }
    }
    eq($part['name'] ?? null, 'İkinci (yeni)', 'en yeni updated_at kazandı; eski yok sayıldı');
}

fwrite(STDOUT, "\nTEST 5 ⭐ — push sırasında ağ koptu, istemci tekrar dener → çift kayıt YOK\n");
{
    [$db] = make_test_db();
    $t = seed_tenant($db);
    $svc = new SyncService($db, $t['tenant_id'], $t['user_id']);
    $ids = scaffold($svc);
    $svc->push([opMove($ids['part_id'], $ids['location_id'], 50, 'initial', iso(1))]);

    // Aynı op_id ile 5 yeniden deneme (yanıt kaybolmuş varsayımı)
    $op = opMove($ids['part_id'], $ids['location_id'], -10, 'consume', iso(5), Uuid::v7());
    for ($i = 0; $i < 5; $i++) {
        $svc->push([$op]);
    }
    // Ledger'da bu op için tek satır olmalı
    $txCount = (int) ($db->one('SELECT COUNT(*) AS c FROM stock_transactions WHERE reason = :r',
        ['r' => 'consume'])['c'] ?? 0);
    eq($txCount, 1, 'defterde tek consume kaydı (5 denemeye rağmen)');
    eq(currentQty($svc, $ids['part_id'], $ids['location_id']), 40.0, 'qty 50-10=40 (yalnız bir kez)');
}

fwrite(STDOUT, "\nTEST 6 — A'da parça sil, B'de aynı parçaya hareket → veri kaybı yok\n");
{
    [$db] = make_test_db();
    $t = seed_tenant($db);
    $svc = new SyncService($db, $t['tenant_id'], $t['user_id']);
    $ids = scaffold($svc);
    $svc->push([opMove($ids['part_id'], $ids['location_id'], 30, 'initial', iso(1))]);

    // Cihaz A parçayı siler (soft delete)
    $del = ['op_id' => Uuid::v7(), 'type' => 'delete', 'entity' => 'part',
            'data' => ['id' => $ids['part_id'], 'updated_at' => iso(20)]];
    $svc->push([$del]);
    // Cihaz B silinmeden önce çekilmiş bir hareketi push eder
    $mv = $svc->push([opMove($ids['part_id'], $ids['location_id'], -5, 'consume', iso(18))]);

    eq(count($mv['applied']), 1, 'hareket yine de kaydedildi');
    $part = $db->one('SELECT deleted_at FROM parts WHERE id = :id', ['id' => $ids['part_id']]);
    check(($part['deleted_at'] ?? null) !== null, 'parça soft-delete işaretli');
    $txExists = $db->one('SELECT 1 AS x FROM stock_transactions WHERE reason = :r', ['r' => 'consume']);
    check($txExists !== null, 'defter kaydı korunuyor (veri kaybı yok)');
}

fwrite(STDOUT, "\nTEST 7 ⭐ — Tenant izolasyonu: A, B'nin verisine erişemez → 404\n");
{
    [$db] = make_test_db();
    $tA = seed_tenant($db, 'Atolye A');
    $tB = seed_tenant($db, 'Atolye B');
    $svcA = new SyncService($db, $tA['tenant_id'], $tA['user_id']);
    $svcB = new SyncService($db, $tB['tenant_id'], $tB['user_id']);

    $idsB = scaffold($svcB);  // B'nin part+location'ı

    // A, B'nin part_id'sine hareket push etmeye çalışır
    $res = $svcA->push([opMove($idsB['part_id'], $idsB['location_id'], -1, 'consume', iso(5))]);
    eq(count($res['applied']), 0, 'A, B verisine yazamadı');
    eq(count($res['rejected']), 1, 'op reddedildi');
    eq($res['rejected'][0]['reason'] ?? '', 'not_found', 'red sebebi not_found (varlık sızdırılmadı)');

    // A'nın bootstrap'ında B'nin parçası görünmez
    $seen = false;
    foreach ($svcA->bootstrap()['parts'] as $p) {
        if ($p['id'] === $idsB['part_id']) { $seen = true; }
    }
    check(!$seen, "A'nın bootstrap'ında B'nin parçası yok");
}

fwrite(STDOUT, "\nTEST 8 — bootstrap stok == defterden türetilen (checksum tutarlılığı)\n");
{
    [$db] = make_test_db();
    $t = seed_tenant($db);
    $svc = new SyncService($db, $t['tenant_id'], $t['user_id']);
    $ids = scaffold($svc);
    $svc->push([opMove($ids['part_id'], $ids['location_id'], 100, 'initial', iso(1))]);
    $svc->push([opMove($ids['part_id'], $ids['location_id'], -7, 'consume', iso(5))]);
    $svc->push([opMove($ids['part_id'], $ids['location_id'], -3, 'consume', iso(6))]);
    $svc->push([opMove($ids['part_id'], $ids['location_id'], 20, 'purchase', iso(7))]);

    $snapQty = currentQty($svc, $ids['part_id'], $ids['location_id']);
    $derived = (float) ($db->one(
        'SELECT COALESCE(SUM(delta),0) AS s FROM stock_transactions WHERE part_id = :p',
        ['p' => $ids['part_id']]
    )['s'] ?? 0);
    eq($snapQty, 110.0, 'snapshot qty = 100-7-3+20 = 110');
    eq($snapQty, $derived, 'snapshot, defter toplamıyla birebir aynı');
}

fwrite(STDOUT, "\nTEST 9 — level mod (DOLU/AZ/BİTTİ) LWW, sıra dışı olay eski durumu ezmez\n");
{
    [$db] = make_test_db();
    $t = seed_tenant($db);
    $svc = new SyncService($db, $t['tenant_id'], $t['user_id']);
    $partId = Uuid::v7();
    $locId = Uuid::v7();
    $svc->push([
        opUpsertLocation(['id' => $locId, 'code' => 'B1-04', 'type' => 'drawer', 'path' => 'GARAJ/B1/B1-04', 'updated_at' => iso(0)]),
        opUpsertPart(['id' => $partId, 'sku' => 'C-0805-100N', 'name' => '100nF', 'count_mode' => 'level', 'updated_at' => iso(0)]),
    ]);
    $lvl = fn(string $to, string $when) => [
        'op_id' => Uuid::v7(), 'type' => 'stock_move',
        'data' => ['id' => Uuid::v7(), 'part_id' => $partId, 'location_id' => $locId, 'level_to' => $to, 'reason' => 'adjust', 'created_at' => $when],
    ];
    $svc->push([$lvl('low', iso(10))]);
    $svc->push([$lvl('empty', iso(20))]);   // daha yeni → empty
    $svc->push([$lvl('full', iso(15))]);    // sıra dışı (eski) → yok sayılmalı

    $level = $db->one('SELECT level FROM stock WHERE part_id = :p', ['p' => $partId])['level'] ?? null;
    eq($level, 'empty', 'en yeni olay (empty) korundu, sıra dışı full yok sayıldı');
}

fwrite(STDOUT, "\nTEST 10 — audit: sayım sonucu mutlak değere göre delta üretir\n");
{
    [$db] = make_test_db();
    $t = seed_tenant($db);
    $svc = new SyncService($db, $t['tenant_id'], $t['user_id']);
    $ids = scaffold($svc);
    $svc->push([opMove($ids['part_id'], $ids['location_id'], 100, 'initial', iso(1))]);
    // Fiziksel sayım 87 buldu
    $svc->push([['op_id' => Uuid::v7(), 'type' => 'stock_audit',
        'data' => ['part_id' => $ids['part_id'], 'location_id' => $ids['location_id'],
                   'counted_qty' => 87, 'note' => 'aylık sayım', 'created_at' => iso(30)]]]);
    eq(currentQty($svc, $ids['part_id'], $ids['location_id']), 87.0, 'audit sonrası qty = 87');
    $auditTx = $db->one("SELECT delta FROM stock_transactions WHERE reason = 'audit'");
    eq((float) ($auditTx['delta'] ?? 0), -13.0, 'audit hareketi delta = 87 - 100 = -13');
}

fwrite(STDOUT, "\nTEST 11 — pull: since'den sonraki değişiklikleri sırayla döner\n");
{
    [$db] = make_test_db();
    $t = seed_tenant($db);
    $svc = new SyncService($db, $t['tenant_id'], $t['user_id']);
    $ids = scaffold($svc);                       // 2 değişiklik (location, part)
    $boot = $svc->bootstrap();
    $svc->push([opMove($ids['part_id'], $ids['location_id'], 5, 'purchase', iso(5))]); // +1 değişiklik

    $pull = $svc->pull(0, 500);
    check(count($pull['changes']) >= 3, 'pull en az 3 değişiklik döndü');
    eq($pull['has_more'], false, 'has_more false');
    check($pull['cursor'] > 0, 'cursor > 0');

    // since = cursor sonrası boş
    $pull2 = $svc->pull($pull['cursor'], 500);
    eq(count($pull2['changes']), 0, 'cursor sonrası değişiklik yok');
}

fwrite(STDOUT, "\nTEST 12 — sync_ops tenant izolasyonu: A ve B aynı op_id'yi kullanır, ikisi de uygulanır\n");
{
    [$db] = make_test_db();
    $tA = seed_tenant($db, 'Atolye A12');
    $tB = seed_tenant($db, 'Atolye B12');
    $svcA = new SyncService($db, $tA['tenant_id'], $tA['user_id']);
    $svcB = new SyncService($db, $tB['tenant_id'], $tB['user_id']);

    $sharedOpId = Uuid::v7();
    $idsA = scaffold($svcA);
    $svcA->push([opMove($idsA['part_id'], $idsA['location_id'], 5, 'purchase', iso(1), $sharedOpId)]);

    // B AYNI op_id ile farklı bir op (part upsert) push eder
    $partB = Uuid::v7();
    $resB = $svcB->push([[
        'op_id' => $sharedOpId, 'type' => 'upsert', 'entity' => 'part',
        'data' => ['id' => $partB, 'sku' => 'B-12', 'name' => 'B parça', 'count_mode' => 'exact', 'updated_at' => iso(1)],
    ]]);
    eq(count($resB['applied']), 1, "B'nin op'u uygulandı (A'nın op_id'si engellemedi)");
    $seen = false;
    foreach ($svcB->bootstrap()['parts'] as $p) {
        if ($p['id'] === $partB) $seen = true;
    }
    check($seen, "B'nin parçası gerçekten oluştu (sessiz kayıp yok)");
}

fwrite(STDOUT, "\nTEST 13 — eski (sıra dışı) silme, daha yeni düzenlemeyi ezmez (LWW)\n");
{
    [$db] = make_test_db();
    $t = seed_tenant($db);
    $svc = new SyncService($db, $t['tenant_id'], $t['user_id']);
    $partId = Uuid::v7();
    $svc->push([opUpsertPart(['id' => $partId, 'sku' => 'Z-1', 'name' => 'Eski', 'count_mode' => 'exact', 'updated_at' => iso(0)])]);
    // Daha yeni düzenleme
    $svc->push([opUpsertPart(['id' => $partId, 'sku' => 'Z-1', 'name' => 'Yeni', 'count_mode' => 'exact', 'updated_at' => iso(20)])]);
    // Eski (sıra dışı) silme — iso(10) < iso(20)
    $svc->push([['op_id' => Uuid::v7(), 'type' => 'delete', 'entity' => 'part', 'data' => ['id' => $partId, 'updated_at' => iso(10)]]]);

    $row = $db->one('SELECT name, deleted_at, updated_at FROM parts WHERE id = :id', ['id' => $partId]);
    check(($row['deleted_at'] ?? null) === null, 'eski silme yok sayıldı (parça silinmedi)');
    eq($row['name'] ?? null, 'Yeni', 'daha yeni düzenleme korundu');
    check(str_starts_with((string) $row['updated_at'], substr(iso(20), 0, 4)), 'updated_at geri gitmedi');
}

fwrite(STDOUT, "\nTEST 14 — audit: null/geçersiz counted_qty stoğu silmez, reddedilir\n");
{
    [$db] = make_test_db();
    $t = seed_tenant($db);
    $svc = new SyncService($db, $t['tenant_id'], $t['user_id']);
    $ids = scaffold($svc);
    $svc->push([opMove($ids['part_id'], $ids['location_id'], 100, 'initial', iso(1))]);

    $res = $svc->push([['op_id' => Uuid::v7(), 'type' => 'stock_audit',
        'data' => ['part_id' => $ids['part_id'], 'location_id' => $ids['location_id'], 'counted_qty' => null, 'created_at' => iso(5)]]]);
    eq(count($res['rejected']), 1, 'null counted_qty reddedildi');
    eq($res['rejected'][0]['reason'] ?? '', 'unprocessable', 'red sebebi unprocessable');
    eq(currentQty($svc, $ids['part_id'], $ids['location_id']), 100.0, 'stok 0a silinmedi (100 kaldı)');
}

fwrite(STDOUT, "\nTEST 15 — gelecek-tarihli level olayı clamp'lenir (kalıcı kilitlenmez)\n");
{
    [$db] = make_test_db();
    $t = seed_tenant($db);
    $svc = new SyncService($db, $t['tenant_id'], $t['user_id']);
    $partId = Uuid::v7();
    $locId = Uuid::v7();
    $svc->push([
        opUpsertLocation(['id' => $locId, 'code' => 'B1-09', 'type' => 'drawer', 'path' => 'GARAJ/B1/B1-09', 'updated_at' => iso(0)]),
        opUpsertPart(['id' => $partId, 'sku' => 'C-FUT', 'name' => 'gelecek', 'count_mode' => 'level', 'updated_at' => iso(0)]),
    ]);
    // Çok ileri tarihli 'empty'
    $svc->push([['op_id' => Uuid::v7(), 'type' => 'stock_move',
        'data' => ['id' => Uuid::v7(), 'part_id' => $partId, 'location_id' => $locId, 'level_to' => 'empty', 'reason' => 'adjust', 'created_at' => '2035-01-01T00:00:00.000Z']]]);

    $row = $db->one('SELECT level, level_at FROM stock WHERE part_id = :p', ['p' => $partId]);
    eq($row['level'] ?? null, 'empty', 'level yazıldı');
    check(strpos((string) $row['level_at'], '2035') === false, 'level_at 2035 değil — geleceğe-karşı clamp uygulandı');
}

fwrite(STDOUT, "\nTEST 16 — seed verisi (UUIDv4) düzenlenebilir; op_id yine katı v7\n");
{
    [$db] = make_test_db();
    $t = seed_tenant($db);
    $svc = new SyncService($db, $t['tenant_id'], $t['user_id']);
    // Seed benzeri v4 id'li kategori
    $v4 = '10cb6b29-699f-47c5-a889-7a4da75fb134';
    $r = $svc->push([[
        'op_id' => Uuid::v7(), 'type' => 'upsert', 'entity' => 'category',
        'data' => ['id' => $v4, 'code' => 'PAS', 'name_tr' => 'Pasif', 'default_count_mode' => 'level', 'updated_at' => iso(0)],
    ]]);
    eq(count($r['applied']), 1, 'v4 id kategori upsert edildi (düzenlenebilir)');
    // Aynı v4 id ile düzenleme (yeni ad)
    $r2 = $svc->push([[
        'op_id' => Uuid::v7(), 'type' => 'upsert', 'entity' => 'category',
        'data' => ['id' => $v4, 'code' => 'PAS', 'name_tr' => 'Pasif (düzenlendi)', 'default_count_mode' => 'level', 'updated_at' => iso(10)],
    ]]);
    eq(count($r2['applied']), 1, 'v4 id kategori yeniden düzenlendi');
    $name = $db->one('SELECT name_tr FROM categories WHERE id = :id', ['id' => $v4])['name_tr'] ?? null;
    eq($name, 'Pasif (düzenlendi)', 'düzenleme uygulandı');
    // op_id v4 ise reddedilir (op_id katı v7)
    $r3 = $svc->push([[
        'op_id' => $v4, 'type' => 'upsert', 'entity' => 'category',
        'data' => ['id' => Uuid::v7(), 'code' => 'X', 'name_tr' => 'X', 'updated_at' => iso(0)],
    ]]);
    eq($r3['rejected'][0]['reason'] ?? '', 'invalid_op_id', 'op_id v4 reddedildi (katı v7)');
}

exit(test_summary());
