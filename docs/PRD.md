# PRD — DEPO

## 1. Problem

Kapalı garajda ~250-600 çeşit elektronik/mekanik parça var. Bir parçayı aramak 5-15 dakika sürüyor. Elde olan parça tekrar sipariş ediliyor. 3D basılmış çekmeceler düzeni iyileştirdi ama **hangi çekmecede ne olduğu kayıtlı değil.**

## 2. Başarı Ölçütleri

| Metrik | Başlangıç | Hedef |
|---|---|---|
| Bir parçayı bulma süresi | 5-15 dk | **< 60 sn** |
| Stok doğruluk oranı (döngüsel sayım) | — | **> %90** |
| 6 ayda mükerrer sipariş | ? | **0** |
| Sistemin haftalık kullanım oranı | — | **> %80** |

**Ölçüm:** Uygulama içinde bir "arama süresi" stopwatch'ı olsun (opsiyonel, arama → bulundu). Basit ama motivasyon için değerli.

## 3. Kullanıcılar

| Rol | Kim | İhtiyaç |
|---|---|---|
| **Sahip (owner)** | Fatih | Her şey. Tek elle, lehim havyası elindeyken çalışabilmeli. |
| **Üye (member)** | İleride: aile, ortak atölye | Okuma + stok hareketi. Silme yok. |
| **Misafir (viewer)** | Ödünç isteyen arkadaş | Sadece "var mı, nerede" görebilir. |

## 4. Temel Kavramlar

### 4.1 Konum (Location)
Fiziksel yer. **Sabittir.** Hiyerarşik ağaç: `Site > Kabin > Raf > Çekmece > Bölme`.
Her konumun benzersiz, kısa, insan-okunur bir `code`'u var: `S1-07`, `A2-31`, `B1-04`.

**Sistem konumları** (fiziksel değil, mantıksal):
- `IN` — Giriş kutusu: gelen ama henüz kaydedilmemiş parçalar
- `W1` — Tezgâh: projede kullanılmak üzere çekilmiş parçalar
- `QT` — Karantina: "belki lazım olur", 12 ay kuralı
- `LOAN-*` — Ödünç: her kişi için otomatik oluşan sanal konum (`LOAN-AHMET`)

> Ödünç verilen parça **kaybolmaz** — sadece konumu değişir. Bu, ödünç modülünü stok modelinin doğal bir parçası yapar.

### 4.2 Parça (Part)
Bir *çeşit*. Fiziksel adet değil. `sku` benzersiz.
Her parça bir **kategoriye** bağlı; kategori onun **öznitelik şablonunu** belirler.

### 4.3 Stok (Stock)
`(parça, konum)` çifti başına bir satır. Aynı parça birden çok konumda olabilir.

### 4.4 Sayım Modu (count_mode)
Parça bazında, kategoriden miras alınır, **uygulama içinden değiştirilebilir**:

| Mod | Ne için | Nasıl çalışır |
|---|---|---|
| `exact` | Pahalı/kritik: IC, MCU, modül, sensör, ekran | Tam adet. `+1 / -1 / -N` |
| `level` | Ucuz sarf: direnç, kondansatör, vida, dupont, makaron | **DOLU / AZ / BİTTİ**. Sayma yok. |
| `unmanaged` | Aletler, tek parçalar (havya, multimetre, filament makarası) | Sadece "nerede?" — miktar takibi yok |

**Varsayılan atama** `db/seed.sql` içinde kategori bazında. Kullanıcı:
- Tek parçada değiştirebilir (parça detay ekranı)
- Toplu değiştirebilir (kategori filtresi → toplu işlem)
- Kategori varsayılanını değiştirebilir (Ayarlar → Kategoriler)

**Neden bu karma model:** 1000 direnci saymak sistemi öldüren şeydir. Sayım yorgunluğu → veri girilmez → veri yanlış olur → sisteme güvenilmez → sistem ölür.

### 4.5 Hareket (Transaction) — Defteri Kebir
**Append-only.** Asla silinmez, güncellenmez. Stok miktarı bu defterden türetilir.

| `reason` | Anlamı |
|---|---|
| `purchase` | Satın alma girişi |
| `consume` | Projede/işte tüketim |
| `transfer` | Konum değişimi (iki satır: `-` ve `+`) |
| `adjust` | Manuel düzeltme |
| `audit` | Sayım sonucu düzeltmesi (mutlak değer) |
| `scrap` | Bozuk/atık çıkışı |
| `loan_out` / `loan_return` | Ödünç verme / iade |

Düzeltme gerekirse **ters kayıt** atılır, orijinal silinmez. Bu, denetim izini korur ve senkronizasyonu matematiksel olarak sağlam kılar (bkz. `SYNC_PROTOCOL.md`).

---

## 5. Ekranlar

### FAZ 1 — MVP (bunlar olmadan envanter girilemez)

#### 5.1 `/scan` — Tarayıcı (ANA EKRAN)
- Uygulama açılınca gelen ekran. Kamera hazır, QR bekliyor.
- QR okunca → konum sayfasına git.
- Alternatif: iPhone'un yerleşik kamerası QR'ı okur → URL açılır → aynı sayfa. **Uygulamayı açmaya bile gerek yok.**
- Manuel kod girişi de olmalı (QR yıpranırsa): `S1-07` yaz → git.

#### 5.2 `/l/:code` — Konum Görünümü
- Başlıkta konum kodu **çok büyük** (uzaktan okunabilir).
- Çekmecenin fotoğrafı (varsa).
- İçindeki parçaların listesi. Her satırda:
  - `exact` → `[−] 42 adet [+]` + uzun basınca "N adet çıkar"
  - `level` → `[DOLU] [AZ] [BİTTİ]` segment butonu
  - `unmanaged` → sadece isim
- `+ Parçayı buraya ekle` butonu.
- **Tek elle kullanılabilir olmalı.** Butonlar ≥ 48px, alt yarıda.

#### 5.3 `/search` — Arama
- Tek kutu. Yazdıkça sonuç (IndexedDB, anında, offline).
- Türkçe karakter duyarsız. `direnc` → `Direnç` bulur.
- Arama alanları: `sku`, `name`, `mpn`, `tags`, öznitelik değerleri.
- Sonuç kartında **en büyük şey KONUM KODU**. Cevap odur.
- Sonuç kartı: `10K ─ 0805 ─ %1` / **`S1-07`** / `DOLU` / [çekmece fotoğrafı]

#### 5.4 `/parts/:id` — Parça Detayı
- Öznitelikler (kategoriye göre dinamik form).
- Hangi konumlarda, ne kadar.
- Hareket geçmişi.
- Sayım modu değiştirme.
- Min stok eşiği.

#### 5.5 `/intake` — Hızlı Giriş
Hedef: **30 saniyeden kısa.**
```
[Fotoğraf çek]  →  [AI önerisi (Faz 2)]  →  Kategori seç
                →  Öznitelikleri doldur (SKU otomatik üretilir)
                →  Konum tara (QR)  →  Miktar / Seviye  →  KAYDET
```
- Aynı kategoriden art arda giriş yapılıyorsa kategori sabit kalsın ("seri giriş modu").
- Var olan SKU tekrar girilirse → "bu parça zaten var, `S1-07`'de. Oraya mı eklensin?"

#### 5.6 `/labels` — Etiket Basımı
- Konum seç (aralık: `S1-01` … `S1-70`).
- A4 etiket sayfası şablonu (boyut ayarlanabilir: örn. 38×21 mm, 3×8 grid).
- Her etikette: **QR** (konum URL'i) + **büyük insan-okunur kod** + küçük kategori ipucu (opsiyonel).
- Tarayıcıdan yazdır (`@media print` CSS).
- QR yoğunluğu düşük tutulmalı → URL kısa olmalı (bkz. `PHYSICAL_LAYOUT.md`).

#### 5.7 `/settings`
- Sayım modu varsayılanları, kategori yönetimi, öznitelik şablonları, dil, yedekleme (JSON export/import).

---

### FAZ 2 — Giriş hızlandırma
- **AI görsel tanıma** (`docs/AI_INTAKE.md`)
- **Ek dosyalar**: datasheet PDF, parça fotoğrafı, çekmece fotoğrafı
- **Eksikler listesi**: `min_qty` altına düşenler → kopyalanabilir alışveriş listesi
- MPN → LCSC/Octopart parametre otomatik doldurma

### FAZ 3 — Modüller
- **Proje / BOM**: "Bu projeyi elimdekilerle yapabilir miyim?" → eksik listesi
- **Ödünç takibi**: kime, ne zaman, ne zaman dönecek. Geciken uyarısı.
- **Tedarikçi / sipariş**: fiyat geçmişi, sipariş oluşturma, gelen siparişi stoka işleme

### FAZ 4 — Olgunluk & ürünleştirme
- **Döngüsel sayım**: aylık rastgele kabin, fark raporu, doğruluk oranı KPI'ı
- **Ölü stok raporu**: 12 aydır hareketsiz parçalar
- **LED bulucu**: ESP32 + WS2812 → aranan çekmece yanar (Home Assistant entegrasyonu)
- **Ağırlıkla sayım**: hassas terazi ile `adet = (ağırlık − dara) / birim_ağırlık`
- Kayıt/onboarding akışı, plan limitleri, faturalama

---

## 6. Kapsam Dışı (bilinçli olarak yapılmayacaklar)

- Barkod tabanlı tedarikçi otomatik girişi → TR tedarikçileri standart 2D barkod basmıyor, hurdada zaten yok. **Getirisi düşük.**
- Gerçek zamanlı çoklu kullanıcı senkronizasyonu (WebSocket) → paylaşımlı hostingde imkânsız, gerek de yok.
- Yerleşik e-ticaret/sepet entegrasyonu → kopyalanabilir liste yeter.
- Karmaşık raporlama/BI → sonra.

---

## 7. Kabuller ve Riskler

| Risk | Etki | Önlem |
|---|---|---|
| Veri girişi yarım kalır | Sistem çöker | Faz 1'i minimal tut, hemen envanterlemeye başla. Kategori kategori bitir. |
| Tüketim işlenmez, veri bozulur | Güven kaybı | Tek dokunuşlu `-` butonu + aylık döngüsel sayım |
| Etiketler solar/düşer | Fiziksel çöküş | Direkt termal kullanma. A4 lazer etiket + şeffaf bant, veya çekmeceye etiket yuvası bas. |
| PLA çekmeceler yazın deforme olur | Fiziksel çöküş | Yeni baskılar **PETG**. Garaj yazın 45-55°C. |
| Aşırı mühendislik | Proje bitmez | Faz kilidi. Faz 1 bitmeden Faz 2 kodu yazılmaz. |
