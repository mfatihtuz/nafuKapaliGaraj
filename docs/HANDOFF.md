# HANDOFF — DEPO

Her oturum sonunda güncellenir: ne yapıldı / ne kaldı / bilinen sorunlar.

---

## 2026-07-17 · FAZ 3b TAMAMLANDI — Ödünç + Tedarikçiler/fiyat + Siparişler (PO)

**Tasarım (FAZ 3a ile aynı kalıp):** SIFIR yeni stok tesisatı. Yeni varlıklar **LWW
katalog** (`loans`, `suppliers`, `part_suppliers`, `purchase_orders`, `po_items`); stok
DAİMA mevcut defterle (delta/level) taşınır. Tüm FAZ 3b tabloları **001_init'te zaten
vardı** → yeni tablo kurulmadı, hiçbir mevcut tabloya sütun eklenmedi.

**Kapsam:**
- **3.4 Ödünç:** borçlu-başına `LOAN-<slug>` sanal göz (id borçlu slug'ından
  DETERMİNİSTİK — çevrimdışı çakışma yok); ödünç ver = `loan_out` iki bacak (kaynak −,
  LOAN +), iade = `loan_return` + `returned_at` kapatma (deterministik txId, idempotent).
  Ödünçler ekranı (borçluya göre, vade rozeti) + parça detayında Ödünç kartı.
- **3.5 Tedarikçiler/fiyat:** `part_supplier` id (part|supplier)'dan deterministik
  (uq_ps + LWW); parça detayında "en ucuz" kartı.
- **3.6 Siparişler:** PO + satır (parça ara-seç ya da ham ad), durum akışı
  (taslak→sipariş→teslim), satır bazlı teslim = `purchase` hareketi (`ref_id`=satır) +
  `received_qty`; PO→satır cascade soft-delete. Alışveriş→PO köprüsü ("Siparişe ekle").

**DB:** `migration 009` = yalnız `idx_tx_ref` (ödünç/sipariş/transfer bağı). schema.sql
eşitlendi. **Sunucu:** 5 repo + SyncService bağlama (bootstrap/catalog/FK sırası) + PO
delete cascade. Client sync tesisatı (dexie v4, apply mapper'ları, bootstrap) 3.5'te kuruldu.

**Adversarial inceleme (5 boyut, 21 ajan):** 8 bulgu, 7 doğrulandı, hepsi giderildi:
- (high) ödünç konumu rastgele id → çevrimdışı `uq_loc_code` çakışması → **deterministik id**.
- (high) `receivePoItem` level parçayı exact işliyordu → **count_mode dallanması**.
- (medium) level modda aynı borçluya çift ödünç iadesi gözü erken boşaltıyordu → **son iade boşaltır**.
- (XSS) `product_url`/`datasheet_url` doğrulamadan href → **`safeHttpUrl` (yalnız http/https)**.

**Bilinen sınır (bilinçli ertelenen — #7 low):** `po_item.received_qty` çok-cihaz eşzamanlı
kısmi teslimde LWW ile ayrışabilir (son-yazan ≠ toplam). **STOK daima doğru** (defter/delta
yetkili); yalnız özet metadata etkilenir — `loans.qty` ile aynı sınıf, garaj tek-cihaz
kullanımında oluşmaz. Ürünleştirmede received_qty defterden türetilebilir.

**Test:** PHP **170** (sync 108 → Test 23 ödünç, Test 24 PO), E2E **240** (EE ödünç, FF
sipariş, GG inceleme-regresyonu), tsc+build temiz. Commit'ler: `e5567e2` 3.5 · `e4bae8d`
3.4 · `79038f9` 3.6 · `f4266b5` docs+migration · `62b1c11` inceleme düzeltmeleri.

---

## 2026-07-17 · FAZ 3a TAMAMLANDI — Projeler + BOM + "Yapabilir miyim?" + proje sanal konumu

**Tasarım (çok-yaklaşım workflow jürisi kazananı):** SIFIR yeni stok tesisatı. `projects`
+ `bom_items` = **LWW katalog varlıkları**; **proje = `type='project'` bir konum** →
"projeye çek/iade/tüket" mevcut stok defterini (`moveStock`, `project_id`, transfer/consume)
kullanır. **"Yapabilir miyim?" = saf Dexie türetmesi** (sunucu ucu YOK, uçak modunda çalışır).
Kanonik **`isFreeStock`** (proje/ödünç/karantina "elde"den dışlanır) feasibility + alışveriş
listesinde tek kaynak.

**Kapsam:**
- **3.1 Projeler + BOM:** proje listesi (durum-gruplu), yeni proje (sanal konum otomatik),
  BOM içe aktarma (KiCad/CSV → MPN→SKU→değer+footprint eşleştirme, `bomImport`/`bomMatch`),
  elle parça eşleştirme.
- **3.2 "Yapabilir miyim?":** yeşil/kırmızı bant + eksik/eşleşmemiş liste (canlı, offline).
- **3.3 Proje sanal konumu:** her BOM kalemi için "Çek" (çok serbest çekmeceden toplar),
  proje gözü içeriği (iade/tüket), stok defterinde `project_id`.

**DB:** `db/migrations/008_projects_bom.sql` — additive ALTER (bom_items KiCad ham alanları
+ 2 indeks). projects/bom_items 001'de vardı, hiç kullanılmamıştı → DROP yok, veri kaybı yok.
schema.sql eşitlendi. **Sunucu değişikliği minimal:** 2 repo + SyncService bağlama + proje
delete cascade.

**Adversarial inceleme (5 boyut):** 15 bulgu; doğrulananlar düzeltildi — çift-dokunuş kilidi
(negatif stok), öz-stok feasibility, çok-konum çekme, BOM yanlış-eşleşme (footprint/substring),
proje-delete BOM cascade. Bilinçli ertelenen: çok-cihaz eşzamanlı çekme delta-negatifi
(ürünleştirme), arama proje/ödünç gözlerini gösterir (bilgilendirici, "nerede" sorusu),
proje listesi feasibility N+1 (garaj ölçeğinde sorun değil).

**Karar varsayılanları (araç hatasıyla sorulamadı; sonradan değiştirilebilir):** BOM formatı
gruplanmış+MPN-öncelikli · yeniden içe aktarma = değiştir · bitiş = elle iade uyarısı (stok
varken arşiv engellenir) · feasibility 'elde' = tezgah serbest (proje/ödünç/karantina hariç).

**Test:** PHP **138** (sync 76), E2E **205** (BB projeler + CC öz-stok/çok-konum), tsc+build
temiz. Commit'ler: `c307589` backend · `96feb30` client · `7b489d3` UI · `cd7d57d` düzeltmeler.

---

## 2026-07-16 · Barkod tarama + son hareketi geri al (hızlı kazanımlar)

**Barkod:** `lib/scanner.ts` multiFormat (BrowserMultiFormatReader — QR + EAN/UPC/
Code128/DataMatrix/PDF417/Aztec); `ScanModal` yeniden kullanılabilir kamera modalı
(kamera reddedilirse elle giriş, StrictMode-güvenli kapatma). Intake'e **MPN + üretici
alanı + barkod butonu** (poşet barkodu → MPN); AI önerisi de MPN/üretici doldurur;
barkod bilinen parçadaysa uyarır. Search'e barkod butonu (useSearch zaten mpn eşliyor).
Konum taraması QR-only kalır.

**Undo:** `undoLastMovement` — defter append-only → hareketi silmez, tersini yazar.
Yalnız EN SON hareket, **transfer hariç** (level transferi dahil — iki bacak da reason
'transfer'). Telafi id'si kaynaktan **deterministik** (idempotent: çift-dokunuş/iki-cihaz
negatif stok yapmaz) + düğmede in-flight kilit. PartDetail geçmiş kartında buton.

**Adversarial inceleme (2 tur):** feature diff'inde 5 gerçek bulgu bulundu ve düzeltildi:
level-transfer undo guard atlanması (hayalet stok), undo idempotentlik (negatif stok),
mevcut parçaya MPN backfill (sessiz kayıp), ScanModal kamera sızıntısı, kategori-değişince
MPN sızması. Hepsi regresyon testli.

**Test:** E2E 189 (W undo, X barkod-arama, Y MPN kalıcı, Z level-transfer guard,
AA MPN backfill), tsc temiz. **Sunucu değişikliği YOK** (mevcut stok/parça sync yolu).
Commit'ler `a3e0ef9` (feature) + `09b9da9` (düzeltmeler).

---

## 2026-07-16 · CSV / toplu parça içe aktarma (kurulum hızlandırıcı)

**Neden:** İlk stoklamada en büyük sürtünme 250-600 SKU'yu elle girmek. Sprint
kuralı "FAZ 3 öncesi 100+ SKU gir" bununla engelleniyordu → içe aktarma o kapıyı açar.

**Yapıldı (Ayarlar → İçe Aktar):**
- `lib/csv.ts` — bağımlılıksız CSV ayrıştırıcı: ayraç sezme (`;`/`,`/tab — TR Excel `;`),
  tırnak kaçışı, CRLF, BOM; şablon üretimi (`toCsvRow`).
- `lib/partImport.ts` (saf/test edilebilir) — TR/EN başlık eşleme, kategori (kod/ad) +
  konum (kod) çözümleme, sayım-yöntemi/doluluk/birim eşanlamlıları, TR ondalık sayı,
  SKU verilmişse ASCII/upper + çakışma hatası / boşsa addan benzersiz üretim, satır-satır
  doğrulama (geçerli/hatalı + sebep).
- `actions.importPartsBulk` — parça satırları + upsert op'ları tek transaction (sıra:
  parça önce, stok sonra), sonra başlangıç stoğu (miktar/doluluk), tek sync tetiği.
- `ImportSection.tsx` — yapıştır/dosya yükle, örnek şablon indir, geçerli/hatalı önizleme.
- **Sunucu değişikliği YOK** — normal parça/stok sync yolundan geçer (mevcut tenant
  doğrulaması + prepared statement). DB şeması değişmez → migration gerekmez.

**Test:** E2E V1-V9 (ayraç sezme, kategori/konum çözümleme, SKU üretimi+çakışma reddi,
başlangıç stoğu exact 150 & level DOLU, hatalı satır reddi). Toplam **E2E 173**, tsc temiz.
Commit `ca6633a`.

---

## 2026-07-16 · FAZ 2 TAMAMLANDI — ekler/foto, AI tanıma, eksik liste, MPN

**Kapsam (tümü çalışır + test edildi):**
- **2.1/2.2 Foto/PDF ekleri** — parça + konum. Offline-first: foto istemcide ~1600px
  JPEG'e küçültülür (canvas), sha256, `uploads` (yerel blob kuyruğu) → online olunca
  `flushUploads` multipart yükler, `attachments` (senkronlu LWW metadata) düşer. Sunucu:
  GD ile 1600px main + 320px thumb, EXIF strip, sha256 byte-dedup (tek disk kopyası),
  finfo gerçek-mime, webroot-dışı `private/storage`. UI: `PhotoGallery` (kamera/galeri,
  bekleyen+yüklenmiş önizleme, tam ekran, sil), arama kartı + parça/konum thumbnail.
- **2.3 AI tanıma** — Intake'te fotoğraftan öneri (ad/özellik doldurur; SKU'yu istemci
  üretir). Sunucu-tarafı Anthropic proxy; anahtar YALNIZCA `config['ai']['api_key']`,
  frontend'e ASLA gitmez. Anahtar yoksa tüm uçlar 200+disabled (nazik degradasyon).
- **2.4 Eksik/alışveriş listesi** — min stok altı (toplam) + tükenen doluluk; kategoriye
  göre grupla, panoya kopyala. `/shopping`.
- **2.5 MPN** — `api.mpnLookup` iskeleti (sağlayıcı erişimi canlıda anahtar girilince).

**DB:** `db/migrations/007_attachments.sql` (attachments final şema — owner_type ENUM,
kind photo/pdf, width/height, sort_order, updated_at LWW, sha256 NON-UNIQUE index).
schema.sql güncel. Kullanıcı phpMyAdmin→SQL'e yapıştırıp çalıştırmalı.

**config.php:** `storage` (path + limitler) + `ai` bloğu (varsayılan kapalı) eklendi.

**Adversarial inceleme (UltraCode, 5 boyut + bağımsız doğrulama):** 12 gerçek bulgu
bulundu ve düzeltildi; her biri için regresyon testi:
- **KRİTİK path-traversal/LFI:** attachment sync-push ile `storage_path` ezilip fileFor
  üzerinden `private/config.php` (DB parolası + Anthropic anahtarı) / çapraz-tenant dosya
  okunabiliyordu. Düzeltme (2 kat): sync'te attachment UPSERT reddi (metadata yalnız
  sunucu store()) + fileFor realpath containment.
- Yüksek: PDF stored-XSS → Content-Disposition: attachment; idempotent yükleme (istemci
  id = PK); GD piksel bombası (40 MP tavan, tek-decode).
- Orta: flushUploads cross-tab lock; iptal yarışı; img onError + /api/files SW cache;
  yetim dosya (sahip doğrulaması diske yazmadan önce).
- Düşük: kalıcı-hata rozeti; sha dedup; ?thumb boolean.

**Testler:** PHP 115 (attachment 31, http 27, sync 57), E2E 164 — HEPSİ YEŞİL.
tsc strict + build temiz. Commit'ler: `0a5bb66` (backend), `1090730` (frontend),
`81c8a35` (güvenlik düzeltmeleri).

**Bilinen sınır / bilinçli:** Aynı foto FARKLI cihazlardan farklı up.id ile eklenirse
sunucuda iki metadata satırı olabilir (disk baytı tek kopya); istemci-içi sha dedup tek
cihazda çifti önler. MPN sağlayıcı entegrasyonu (LCSC/Nexar) canlıda anahtar bekliyor.

---

## 2026-07-16 · FAZ 2 başladı — Parça Ekle'de "Kategoriyi düzenle" pop-up

**Karar:** prefix/suffix ŞİMDİLİK eklenmiyor (değeri kompakt yaz: 10K/12V). Gerçek
sürtünme görülünce "birimi de koda kat" kutusu düşünülecek.

**Yapıldı:** Kategori düzenleme editörü tek bileşene çıkarıldı (`CategoryEditor.tsx`:
`CategoryEditForm` + `CategoryEditModal` + `AttributeEditor`/`emptyCategory`). Ayarlar→
Kategoriler artık bu ortak formu kullanıyor. Parça Ekle 2. adımda **"Kategoriyi düzenle"**
düğmesi → aynı editör bir pop-up'ta açılıyor; kaydedince kategori güncellenir ve UI
Dexie'den okuduğu için form/SKU canlı yenilenir ("aynı ayarlardan yapılmış gibi").
Tek kaynak → nereden düzenlersen düzenle sonuç aynı. E2E'ye A2.5–A2.7 eklendi
(pop-up açılır, kaydeder, SKU şablonunu bozmaz). **E2E 153/153.**

---

## 2026-07-16 · KRİTİK 2: Sunucu ağacı bozuktu (127 yetim) — UUID'siz onarım

**Kök neden (gerçek DB dökümünden kanıtlandı):** Kullanıcının canlı DB'sinde 173 aktif
kategori / 11 kök vardı AMA **127'si yetimdi** — parent_id'leri var olmayan UUID'lere
işaret ediyordu; kodlar hâlâ eski (XTAL). Sebep migration 005 tasarım hatası:
`ON DUPLICATE KEY UPDATE ... parent_id=VALUES(parent_id)` sabit UUID'e güveniyor.
DB'deki mevcut kategori UUID'leri migration'dakinden farklıysa, (tenant,code) çakışması
mevcut satırın id'sini KORUR ama parent_id'yi migration'ın (var olmayan) YENİ UUID'ine
set eder → toplu yetimleşme.

**Çözüm — `db/migrations/006_category_repair.sql` (UUID'den BAĞIMSIZ):**
Geçici tabloya (code, parent_code) yükle → mevcutları KODA göre güncelle/dirilt (id
korunur) → **parent_id'yi KOD join'i ile bağla**. DB'deki UUID durumu ne olursa olsun
doğru ağacı garanti eder. İdempotent. Gerçek bozuk veriye karşı SİMÜLE edildi:
ÖNCE 127 yetim → SONRA 0 yetim, 11 kök, {11 kök / 31 ara / 131 yaprak}, XTAL→OSC.
SQLite ile SQL+JSON geçerliliği doğrulandı. (Üretici: scratchpad/gen_robust_migration.py)

**Not:** Migration 005 (sabit-UUID) artık 006 ile ikame edildi; ileride migration'lar
kod-join yöntemiyle üretilmeli.

---

## 2026-07-16 · KRİTİK: API yanıtları önbelleğe alınıyordu (bayat bootstrap)

**Kök neden (kesin):** API yanıtları `Cache-Control` başlığı GÖNDERMİYORDU. Bootstrap
bir GET isteği (`/sync/bootstrap`); başlık olmayınca tarayıcının HTTP cache'i yanıtı
saklıyor, çıkış/giriş yapılsa bile sunucuya sormadan ESKİ kategori/konum ağacını
döndürüyordu. Sunucu doğru ağacı (173/11) tutmasına ve cihaz "Güncel" göstermesine
rağmen kullanıcı yarım/eski ağacı görüyordu (ELK altı yarım, ELN/MEK/EVE boş, XTAL).
Teşhis: phpMyAdmin sorgusu tenant'ta 173 aktif kategori / 11 kök doğruladı → sorun
istemci tarafında bayat cache.

**Yapıldı:**
- Sunucu: `Response::json` + config-yok 503 artık `Cache-Control: no-store, no-cache,
  must-revalidate` + `Pragma: no-cache` gönderiyor (tüm API yanıtları).
- İstemci: `fetch(..., { cache: 'no-store' })` — tarayıcı HTTP cache'i tamamen atlanır,
  API çağrıları daima ağdan taze gelir.
- Kullanıcı için: yeni ZIP + bir kez "Sunucudan yenile" / çıkış-giriş → taze bootstrap.

---

## 2026-07-16 · Bozuk kategori ağacı (hayalet kayıt) — temiz yeniden indirme

**Sorun:** Kategori ağacı yeniden yapılandırılıp migration uygulandıktan sonra, cihaz
ÇIKIŞ/GİRİŞ yapmadan yalnızca artımlı senkron yaptıysa: eski (soft-delete) + yeni
kategoriler istemcide karışıyordu → seçicide "2 Diğer", alt-grup kök gibi görünüyor,
bazı yapraklar (ör. Mıknatıs) grubunu kaybediyordu. Kök: `applyBootstrap` `bulkPut`
ile BİRLEŞTİRİYOR, yereli temizlemiyordu; artımlı pull da eski kayıtları silmiyordu.

**Yapıldı:**
- `applyBootstrap` artık yazımdan önce katalog+türetilmiş tabloları TEMİZLER
  (bootstrap = sunucunun tam görüntüsü; hayalet kayıt kalmaz).
- Ayarlar → Senkronizasyon'a **"Sunucudan yenile (temiz indir)"** butonu: yereli silip
  sıfırdan bootstrap eder (`resyncFromServer` + `sync`). Bekleyen işlem varsa engellenir.
- Kullanıcı için anında çözüm: **çıkış → giriş** (zaten `wipeLocalData` + temiz bootstrap).

---

## 2026-07-16 · Cila turu: belirgin başlık, alfabetik listeler, kısa kod, TR karakter

**Yapıldı (kullanıcı geri bildirimi):**
- **Ana başlıklar belirginleşti (Parça Ekle seçici):** kök başlığı artık büyük, kalın,
  BÜYÜK HARF + accent alt çizgi/ikon (alt gruplardan net ayrılır).
- **Tüm veri listeleri alfabetik:** kategori/konum/birim/dolap/etiket-tipi açılır
  menüleri Türkçe sıralı (`localeCompare('tr')`); kategori sıralaması ad'a göre,
  konumlar koda göre (numeric). (Search, PartDetail, Intake, Ayarlar-Kategori/Konum, Etiket.)
- **Kategori kodları ≤3 karakter:** uzun kodlar kısaltıldı (AMPUL→AMP, SERIT→SER,
  XTAL→OSC, VREG→REG, OPTO→OPT); kod giriş alanı `maxLength=3` + sanitize `.slice(0,3)`.
  Konum kodları bu kısıttan muaf (fiziksel yerleşim). UUID'ler korundu (bağlar sağlam).
- **Jargon → günlük dil:** "Aşındırıcı & Kesici"→"Kesici & Zımpara",
  "Standoff & Distans"→"Distans & Ayak", "Nozzle"→"Nozül".
- **ASCII yazılmış Türkçe düzeltildi (isim + öznitelik etiketi + enum seçenek):**
  Zimpara Kagidi→Zımpara Kâğıdı, Uc & Bicak→Uç & Bıçak, Yapistirici→Yapıştırıcı,
  Cozucu→Çözücü, Yag→Yağ, Zincir Yagi→Zincir Yağı, Sunger→Sünger … (~55 dize).
  Geniş tarama sonrası kalıntı yok. `db/seed.sql` + `005_category_tree.sql` yeniden üretildi.
- **Paketleme:** `scripts/pack.sh` — ZIP artık script'le üretilir (kök `.htaccess`
  düşme hatası bir daha olmaz; bütünlük denetimli).

---

## 2026-07-16 · Kategori ağacı → tam 3 kademeli (Kök > Alt grup > Yaprak)

**Yapıldı:** Kategori ağacı, kullanıcının isteğiyle TÜM ana dallarda **tek biçim 3
kademeye** çekildi: `Elektronik > Pasif > Direnç`, `Elektronik > Yarıiletken > Diyot`
gibi. Her 11 kökün altına anlamlı ara gruplar tanımlandı (ör. ELK: Tesisat &
Anahtarlama / Aydınlatma / Bağlantı & Aksesuar; MEK: Bağlantı / Hareket / Sızdırmazlık;
ALT: El aleti / Elektrikli / Ölçüm…). **173 kategori** = 11 kök + **31 ara grup** +
**131 yaprak** (tümü zengin öznitelik şeması + SKU şablonlu, `default_count_mode`
köküyle uyumlu). **71 mevcut kodun UUID'si KORUNDU** (parça↔kategori bağları kopmaz;
R/C/L/D/Q tek-harf kodlar bilinçli istisna — eski SKU'lar R-… biçiminde).

- **Parça Ekle seçici (`Intake.tsx`):** artık gerçek 3 kademe gösteriyor — kalın **kök
  başlığı** (ör. Elektronik) → **ara grup başlığı** (ör. Pasif) → yaprak düğme ızgarası.
  Önceki hâlde ara grup (Pasif Bileşenler) yanlışlıkla en üst başlık oluyordu. Yaprakları
  köke ve ara gruba göre iki kademede toplayan `tree` useMemo + sort_order sıralı.
- **Ayarlar (`CategoriesSection.tsx`):** zaten özyinelemeli (`Row` depth+1) — 3+ kademe
  doğru çiziliyor; üst-kategori seçici döngü korumalı. Ek değişiklik gerekmedi, doğrulandı.
- `db/seed.sql` yenilendi; mevcut kurulum için `db/migrations/005_category_tree.sql`
  (idempotent: hepsini soft-delete → yeni ağacı upsert/dirilt → yetim parçaları serbest
  bırak). Migration sonrası her cihazda uygulamada **çıkış→giriş** gerekir (yeni ağaç iner).

**Test:** E2E **150/150** · PHP **57+27** · tsc/build temiz.

---

## 2026-07-14 · İkinci tur — yol haritası (B1–B9) tamamlandı + cascade rename

**Yapıldı:**
- **Konum kodu cascade rename:** Bir dolabın kodu değişince (ör. `S1`→`SB105`), alt
  konumların KODLARI da önek-değişimiyle güncellenir (`S1-01`→`SB105-01`) ve path'ler
  yeniden hesaplanır. Harici kod çakışması denetimi. (LocationsSection `planSubtree`).
- **B1 — Parça düzenleme genişletildi:** ad/SKU(benzersizlik)/kategori/üretici/MPN/özellikler/
  not/datasheet düzenlenebilir; üretici+MPN artık aramada da indeksli (`buildTags`).
- **B2 — Kullanıcı yönetimi:** istemci doğrulaması + owner'ın üye parolasını sıfırlaması
  (tüm oturumları kapatır). `UserAdminService::resetPassword`, `/api/org/users/password`.
- **B3 — Checksum/self-heal:** `GET /api/sync/checksum` (stok SHA-256, SORT_STRING kanonik);
  istemci `checksum.ts` birebir aynı (crypto.subtle) — PHP/JS çapraz-doğrulandı. `engine`
  ayrışmada resyncFromServer; 3 yanlış-pozitif kapısı (outbox boş / 5dk throttle / crypto).
- **B4 — Hassas sayım (opsiyonel):** Ayarlar→Sistem owner toggle `precise_count`; açık+online
  → `auditStock` (sunucu-yetkili), aksi hâlde optimistik `countStock`. Varsayılan KAPALI.
- **B5 — Güvenlik:** token'lar DB'de SHA-256 hash; outbox exponential backoff; süresi dolan
  oturumların budanması.
- **B6 — Eşzamanlılık:** doluluk eşit-zaman tiebreaker (full>low>empty, sunucu+istemci birebir);
  katalog referanslarında çapraz-tenant savunması (`validateReferences`).
- **B7 — Toplu üretim atomik:** `saveLocationsBulk` — konumlar+outbox tek Dexie transaction.
- **B8 — i18n:** LEVEL/REASON/timeAgo/units sözlüğe taşındı (`levelLabel/reasonLabel/unitLabel`).
- **B9 — Boş-durum:** etikette dolap yoksa yönlendirme; index.php config-yok → 503 + eylem mesajı.
- **Sistem konum kodları yeniden adlandırıldı:** IN→GRS, W1→TZGH, QT→KRNT (ASCII;
  kod kuralı §5). `db/seed.sql` (fresh) + `db/migrations/004_rename_system_locations.sql`
  (mevcut DB; sonra cihazda çıkış/giriş → re-bootstrap).
- Raporlar güncellendi: `ACTION_REPORT.md §A.4` (B-özeti) + `§A.5` (GRS/TZGH/KRNT açıklaması),
  `AUDIT_REPORT.md §4/§7`.

**Bilinen sorunlar / backlog:** Yalnızca ürün fazları kaldı (FAZ 2+): AI ile fotoğraftan
tanıma, kritik-stok alışveriş listesi, projeler/BOM, ödünç, tedarikçi zenginleştirme.
`en.json` çevirisi plan gereği ertelendi (eksik anahtarlar tr'ye düşer).

**Test durumu:** E2E **140/140** · PHP **51+27=78** · tsc/build temiz.

---

## 2026-07-14 · Kapsamlı denetim turu

**Yapıldı:**
- 90 kontrollük kalıcı E2E paketi: `web/e2e/audit.mjs` (build + preview + `node e2e/audit.mjs`).
- 34 hata düzeltildi (tam liste: `docs/AUDIT_REPORT.md` §3). Öne çıkanlar: tenant izolasyonu
  (hesap değişiminde yerel veri silme), çıkışta bekleyen-işlem koruması, push serileştirme
  (GET_LOCK), bekleyen-upsert'li not_found reddinin geçici sayılması, miktar>0 zorunluluğu,
  −N sınırı, kategori döngü/tekillik/yetim korumaları, görünmez Düzenle düğmesi,
  grup konumda alt-konum listesi.
- Raporlar: `docs/AUDIT_REPORT.md` (bulgular) + `docs/ACTION_REPORT.md` (yapılan/yapılacak).

**Yapıldı (devamı — aynı gün):** UI/UX turu tamamlandı:
- LocationPicker: dolap başlıklı GRUPLU konum seçici (Parça Ekle + Taşı);
  yazarken erken "konum yok" hatası basılmaz, grup koduna amber açıklama.
- Parça detayında etiketli "Başka çekmeceye taşı" akışı (belirsiz ikon gitti);
  geçersiz/grup hedefte düğme pasif.
- Aramaya KONUM (dolap) filtresi + kartlarda kategori chip'i.
- Etiket tipi ↔ dolap bağı: ayarlarda tipe dolap ata; Etiket Yazdır'da dolap
  seçilince tip OTOMATİK gelir. E2E 95/95.

**Bilinen sorunlar / backlog:** `docs/ACTION_REPORT.md` §B (konum CRUD ekranı yok,
sayım ekranı yok, checksum/self-heal yok, token hash, backoff…).

**Test durumu:** E2E 90/90 · PHP 41+22 · tsc/build temiz.

---

## Durum: FAZ 0 + FAZ 1 (MVP) TAMAMLANDI

Uygulama uçtan uca inşa edildi ve test edildi. Kalan tek adım: **canlıya yükleme**
(ağ politikası bu ortamdan FTP'yi engellediğinden kullanıcı tarafında yapılacak —
bkz. `docs/DEPLOY.md`).

### Backend (`api/`) — PHP 8.1+, Composer'sız
- Core: Autoloader (PSR-4), Db (PDO), Router, Request/Response, Uuid (UUIDv7), HttpException
- Auth: register/login/logout/me — Argon2id + opak httpOnly session (JWT yok)
- TenantMiddleware + BaseRepository — her sorguda `tenant_id` zorunlu
- SyncService (kalp): bootstrap / pull / push, op başına transaction, idempotent
- StockService: hareket → stok türetme (exact/level/audit)
- Append-only ledger + change_log + sync_ops
- **Testler: 40 doğrulama geçiyor** (`api/tests/` — `php api/tests/sync_test.php`, `http_test.php`)
  - SYNC_PROTOCOL §8'in tamamı: Test 3 (delta toplanabilirliği), Test 5 (idempotency),
    Test 7 (tenant izolasyonu), LWW, level LWW, audit, HTTP uçtan uca

### Frontend (`web/`) — React 18 + TS (strict) + Vite 5 + Tailwind 3 + PWA
- Offline-first: Dexie (IndexedDB) tek doğruluk kaynağı; UI daima `useLiveQuery`
- Sync motoru: outbox, pull→push→pull, tetikleyiciler, yerel idempotent türetme
- Ekranlar: Login, Scan (ZXing QR), Konum (`/l/:code`), Arama (TR-duyarsız),
  Parça detay, Hızlı giriş (SKU motoru + seri mod), Etiket (QR + A4 print), Ayarlar
- Modern tema: palet #14213d/#fca311/#000/#e5e5e5/#fff, mobil-öncelikli, ≥48px
- i18n (tr dolu, en kısmi), base path `/depo_yonetimi`, PWA (manifest + ikonlar + SW)
- **Doğrulama:** `tsc` strict + `vite build` temiz; üretim build'i gerçek tarayıcıda
  (Playwright/Chromium) açılıyor, login render oluyor, doğru API yoluna istek atıyor.

### Dağıtım (`scripts/`, `docs/DEPLOY.md`)
- `deploy.sh` — build + lftp yükleme (FTP creds env'den; config.php korunur)
- `backup.php` — cron günlük JSON yedek
- `gen_icons.php` — PWA ikon üreteci (GD)

## Ne kaldı
- **Canlı kurulum** (kullanıcı tarafı): DB oluştur + `schema.sql`/`seed.sql` içe aktar,
  `private/config.php` doldur, `deploy.sh` çalıştır, `/api/health` doğrula. `docs/DEPLOY.md`.
- **Envanter girişi** — SPRINT_PLAN ⛔ "BURADA DUR": FAZ 1 sonrası garajı envanterle.
- FAZ 2-4 (AI tanıma, ek dosyalar, BOM/proje, ödünç, döngüsel sayım, ürünleştirme)
  — faz-kilitli; en az ~100 SKU girilmeden başlanmaz (SPRINT_PLAN).

## Adversarial inceleme sonrası düzeltmeler
5 boyutlu düşmanca inceleme + bağımsız doğrulama çalıştırıldı; 20 gerçek bulgu
bulundu ve düzeltildi (data-integrity/güvenlik), her biri için regresyon testi eklendi:
- softDelete LWW guard, bootstrap tutarlı-okuma (snapshot/cursor yarışı)
- sync_ops tenant-scope (composite PK + exists tenant filtresi)
- audit counted_qty doğrulaması, level created_at geleceğe-karşı clamp
- istemci: outbox kararlı sıralama (++seq), reddedilen op'ta stok geri-alma,
  deneme üst sınırı, engine dinleyici temizliği, silinen parça/konum filtreleri,
  Intake zorunlu-alan doğrulaması, Scan kamera sızıntısı

## Bilinçli ertelenenler (FAZ 4 / ürünleştirme — düşük öncelik)
- Login/register **rate limiting** (IP+e-posta) — canlıda önerilir
- **E-posta doğrulama** akışı (kayıt) — çoklu-tenant ürünleştirmede
- Oturum **rotasyonu / idle timeout** — spec 90 gün cookie diyor (ARCHITECTURE §3),
  mevcut davranış tasarıma uygun; sertleştirme ileride

## Bilinen sorunlar / notlar
- `stock_audit`: istemci offline optimistik ledger kaydı ÜRETMEZ; sonuç sync turunda
  yansır (drift'e karşı sunucu-yetkili delta — SYNC_PROTOCOL §5.3). moveStock/setLevel
  tam offline-optimistik.
- ZXing scanner chunk'ı büyük (~410KB); yalnızca `/scan`'de tembel yükleniyor, SW cache'liyor.
- `config.php` ve `storage/` git ve deploy `--delete` dışıdır (asla silinmez).
