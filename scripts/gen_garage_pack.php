<?php
declare(strict_types=1);

/**
 * Garaj genişletme paketi üreteci: standart garaj/atölye kategorileri + etiket tipleri.
 * Çıktı:
 *   db/genisletme.sql   — mevcut DB'ye eklemek için (tenant otomatik bulunur, INSERT IGNORE)
 *   db/seed.sql         — sonuna eklenir (yeni kurulumlar için, @tenant referanslı)
 * Çalıştır: php scripts/gen_garage_pack.php
 */

require __DIR__ . '/../api/src/Core/Uuid.php';
use Depo\Core\Uuid;

// Tek alanlı varsayılan öznitelik şeması (intake her zaman doldurulabilir; kullanıcı sonradan zenginleştirir).
$defAttr = '[{"key":"deger","label_tr":"Ölçü / Tanım","type":"text","required":true,"in_sku":true,"order":1}]';

// [code, name_tr, name_en, parentCode|null, mode, hasTemplate]
$cats = [
  // grup, alt...
  ['HRD','Hırdavat & Bağlantı','Hardware',null,'level',false],
  ['CIV','Cıvata','Bolt','HRD','level',true],
  ['DBL','Dübel & Ankraj','Anchor','HRD','level',true],
  ['PRC','Perçin','Rivet','HRD','level',true],
  ['MEN','Menteşe & Braket','Hinge & Bracket','HRD','exact',true],
  ['KLP','Kelepçe & Kroşe','Clamp','HRD','level',true],

  ['EAL','El Aleti','Hand Tool',null,'unmanaged',false],
  ['TVD','Tornavida & Uç','Screwdriver','EAL','unmanaged',true],
  ['PNS','Pense & Kesici','Pliers','EAL','unmanaged',true],
  ['ANH','Anahtar & Lokma','Wrench & Socket','EAL','unmanaged',true],
  ['CKC','Çekiç & Darbe','Hammer','EAL','unmanaged',true],
  ['TST','Testere & Kesme','Saw','EAL','unmanaged',true],
  ['OLM','Ölçüm & İşaretleme','Measuring','EAL','unmanaged',true],

  ['ELE','Elektrikli Alet','Power Tool',null,'unmanaged',false],
  ['MTK','Matkap & Vidalama','Drill/Driver','ELE','unmanaged',true],
  ['TSL','Taşlama & Kesme','Grinder','ELE','unmanaged',true],
  ['ZMK','Zımpara Makinesi','Sander','ELE','unmanaged',true],
  ['IST','Havya & İstasyon','Soldering Station','ELE','exact',true],

  ['KSF','Kesici & Aşındırıcı Sarf','Cutting & Abrasive',null,'level',false],
  ['MUC','Matkap Ucu','Drill Bit','KSF','exact',true],
  ['DSK','Kesme / Taşlama Diski','Disc','KSF','level',true],
  ['ZMP','Zımpara Kağıdı','Sandpaper','KSF','level',true],
  ['UBC','Uç & Bıçak','Blade & Bit','KSF','level',true],

  ['KIM','Kimyasal & Yapıştırıcı','Chemical & Adhesive',null,'level',false],
  ['YAP','Yapıştırıcı','Adhesive','KIM','level',true],
  ['SLK','Silikon & Dolgu','Sealant & Filler','KIM','level',true],
  ['YAG','Yağ & Gres','Lubricant','KIM','level',true],
  ['SPR','Sprey & Boya','Spray & Paint','KIM','level',true],
  ['TMZ','Çözücü & Temizleyici','Solvent & Cleaner','KIM','level',true],

  ['TES','Elektrik Tesisat','Electrical Fixtures',null,'exact',false],
  ['PRZ','Priz & Fiş','Socket & Plug','TES','exact',true],
  ['DAN','Duvar Anahtarı','Wall Switch','TES','exact',true],
  ['SGT','Sigorta & Kaçak Akım','Fuse & Breaker','TES','exact',true],
  ['KNL','Kablo Kanalı & Klemens','Trunking & Terminal','TES','level',true],
  ['IZB','İzole Bant & Makaron','Tape & Heatshrink','TES','level',true],

  ['GUV','Güvenlik & KKD','Safety & PPE',null,'level',false],
  ['ELD','Eldiven','Gloves','GUV','level',true],
  ['GZL','Gözlük & Siperlik','Eyewear','GUV','exact',true],
  ['MSK','Maske & Solunum','Mask & Respirator','GUV','level',true],
  ['KLK','Kulaklık','Ear Protection','GUV','exact',true],

  ['SIH','Sıhhi Tesisat','Plumbing',null,'level',false],
  ['BRU','Boru & Hortum','Pipe & Hose','SIH','level',true],
  ['BGL','Dirsek & Bağlantı','Fittings','SIH','level',true],
  ['VNA','Vana & Musluk','Valve & Tap','SIH','exact',true],
  ['CNT','Conta & Sızdırmazlık','Gasket & Seal','SIH','level',true],
];

// UUID üret + parent çöz
$ids = [];
foreach ($cats as $c) { $ids[$c[0]] = Uuid::v7(); }

$sortBase = 400;
function q(?string $s): string { return $s === null ? 'NULL' : "'" . str_replace("'", "''", $s) . "'"; }

// Kategori satırlarını (tenant değişkeni parametreli) üret
function catRows(array $cats, array $ids, string $defAttr, int $sortBase): string
{
    $rows = [];
    $i = 0;
    foreach ($cats as $c) {
        [$code, $tr, $en, $parent, $mode, $hasTpl] = $c;
        $id = $ids[$code];
        $pid = $parent === null ? 'NULL' : "'{$ids[$parent]}'";
        $tpl = $hasTpl ? "'{$code}-{deger}'" : 'NULL';
        $attr = $hasTpl ? "'" . str_replace("'", "''", $defAttr) . "'" : 'NULL';
        $sort = $sortBase + ($i++ * 5);
        $rows[] = "  ('{$id}', @tenant, {$pid}, " . q($code) . ", " . q($tr) . ", " . q($en) . ", {$tpl}, '{$mode}', {$attr}, {$sort})";
    }
    return implode(",\n", $rows);
}

$colList = '(id, tenant_id, parent_id, code, name_tr, name_en, sku_template, default_count_mode, attribute_schema, sort_order)';
$rows = catRows($cats, $ids, $defAttr, $sortBase);

// Etiket tipleri (fiziksel çekmece/kabin tiplerine göre) — settings.label_types
$labelTypes = [
  ['id' => Uuid::v7(), 'name' => 'S1 · 70’lik göz (küçük)', 'w_mm' => 30, 'h_mm' => 12, 'cols' => 6, 'rows' => 22, 'qty' => 70],
  ['id' => Uuid::v7(), 'name' => 'S2/S3 · modüler çekmece', 'w_mm' => 38, 'h_mm' => 21, 'cols' => 5, 'rows' => 13, 'qty' => 42],
  ['id' => Uuid::v7(), 'name' => 'A1 · büyük çekmece', 'w_mm' => 50, 'h_mm' => 30, 'cols' => 4, 'rows' => 9, 'qty' => 16],
  ['id' => Uuid::v7(), 'name' => 'A2 · 3D küçük çekmece', 'w_mm' => 38, 'h_mm' => 21, 'cols' => 5, 'rows' => 13, 'qty' => 40],
  ['id' => Uuid::v7(), 'name' => 'B1 · dar hazne', 'w_mm' => 40, 'h_mm' => 15, 'cols' => 5, 'rows' => 18, 'qty' => 40],
  ['id' => Uuid::v7(), 'name' => 'C1 · kule çekmecesi', 'w_mm' => 50, 'h_mm' => 30, 'cols' => 4, 'rows' => 9, 'qty' => 9],
];
$labelJson = json_encode($labelTypes, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$labelSql = str_replace("'", "''", $labelJson);

// --- 1) Standalone: db/genisletme.sql (mevcut DB) ---
$standalone = "-- ============================================================\n"
  . "-- GARAJ GENİŞLETME PAKETİ (mevcut kuruluma ekle)\n"
  . "-- phpMyAdmin > (veritabanını seç) > Import ile bir kez çalıştır.\n"
  . "-- • Standart garaj/atölye kategorileri (hırdavat, el/elektrikli alet, kimyasal,\n"
  . "--   tesisat, güvenlik, sıhhi tesisat…)\n"
  . "-- • Etiket tipleri (fiziksel çekmece tiplerine göre)\n"
  . "-- Güvenli: kategori kodu zaten varsa atlar; ayarları birleştirir.\n"
  . "-- NOT: Ekledikten sonra uygulamada bir kez çıkış/giriş yap (yeniden bootstrap).\n"
  . "-- ============================================================\n\n"
  . "SET NAMES utf8mb4;\n"
  . "SET @tenant := (SELECT tenant_id FROM tenant_users ORDER BY created_at ASC LIMIT 1);\n\n"
  . "INSERT IGNORE INTO categories {$colList} VALUES\n{$rows};\n\n"
  . "-- Etiket tipleri (varsa üzerine yazar)\n"
  . "UPDATE tenants SET settings = JSON_SET(COALESCE(settings, JSON_OBJECT()), '$.label_types', CAST('{$labelSql}' AS JSON)) WHERE id = @tenant;\n";

file_put_contents(__DIR__ . '/../db/genisletme.sql', $standalone);
echo "✓ db/genisletme.sql yazıldı (" . count($cats) . " kategori, " . count($labelTypes) . " etiket tipi)\n";

// --- 2) seed.sql sonuna ekle (yeni kurulumlar) ---
$seedFrag = "\n-- ---------- Garaj/atölye genişletme (standart malzemeler) ----------\n"
  . "INSERT INTO categories {$colList} VALUES\n{$rows};\n\n"
  . "-- Etiket tipleri (fiziksel çekmece tiplerine göre)\n"
  . "UPDATE tenants SET settings = JSON_SET(settings, '$.label_types', CAST('{$labelSql}' AS JSON)) WHERE id = @tenant;\n";

$seedPath = __DIR__ . '/../db/seed.sql';
$seed = file_get_contents($seedPath);
if (strpos($seed, 'Garaj/atölye genişletme') === false) {
    file_put_contents($seedPath, $seed . $seedFrag);
    echo "✓ db/seed.sql sonuna eklendi\n";
} else {
    echo "• db/seed.sql zaten içeriyor, atlandı\n";
}
