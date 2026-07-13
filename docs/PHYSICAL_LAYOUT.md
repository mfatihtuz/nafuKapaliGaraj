# PHYSICAL_LAYOUT — Fiziksel Yerleşim ve Etiketleme

## 1. Adresleme Şeması

```
GARAJ (site)
├── S1  Sembol 105 — 70'lik gözlü raf          →  S1-01 … S1-70          (70 göz)
├── S2  Sembol Y114 — 9 modül × 4 çekmece      →  S2-01-1 … S2-09-4      (36 göz)
├── S3  Sembol Y112 — 3 modül × 2 çekmece      →  S3-01-1 … S3-03-2      ( 6 göz)
├── A1  3D A Tipi — büyük çekmece              →  A1-01 … A1-16          (16 göz)
├── A2  3D A Tipi — küçük çekmece              →  A2-01 … A2-40          (40 göz)
├── B1  3D B Tipi — dar hazne (elektronik)     →  B1-01 … B1-40          (40 göz)
├── C1  Kule — hobi çekmecesi                  →  C1-01 … C1-09          ( 9 göz)
│                                                              TOPLAM: 217 göz
├── IN  Giriş kutusu   (sistem konumu)
├── W1  Tezgâh         (sistem konumu)
└── QT  Karantina      (sistem konumu)
```

### Değişmez kurallar

1. **Konum kodu asla değişmez.** `S1-07` bugün direnç, yarın konnektör tutabilir. Kodu aynı kalır.
2. **Kabin adına kategori yazma.** "Dirençler dolabı" deme. Kategori değişir, etiket değişmez.
3. **Numaralandırma soldan sağa, yukarıdan aşağıya.** Beyin bunu doğal bulur.
4. **Genişletilebilirlik:** A2'ye 41. çekmeceyi eklersen `A2-41` olur. İki haneli alan 99'a kadar yeter. B1 için de aynı.

### Sistem konumlarının anlamı

| Kod | Kural |
|---|---|
| `IN` | Kargo geldi → kutu buraya. **Sisteme girilmeden çekmeceye gitmez.** Tek istisna yok. |
| `W1` | Tezgâha çektiğin her parça buraya *transfer* edilir. Böylece "nerede?" sorusunun cevabı hep doğru olur. Proje bitince tezgâhı boşalt. |
| `QT` | "Belki lazım olur" kutusu. 12 ay dokunulmazsa → at. Aramada varsayılan olarak **gizli** olsun (gürültü yapmasın), filtreyle görünsün. |
| `LOAN-*` | Ödünç verdiğinde otomatik oluşur (`LOAN-AHMET`). Parça kaybolmaz, sadece konum değiştirir. |

---

## 2. Çekmece Türü → Ne Konur?

| Kabin | Fiziksel özellik | Uygun içerik | Sayım modu eğilimi |
|---|---|---|---|
| **B1** (dar hazne) | Dar, derin | SMD makaraları, kesilmiş SMD şeritleri, küçük pasifler | `level` |
| **S1** (70 göz) | Küçük, çok sayıda | THT pasifler, diyot, LED, transistör, küçük IC | `level` / `exact` |
| **S2/S3** | Orta | Konnektör aileleri, buton, trimpot | `level` |
| **A2** (3D küçük) | Küçük | Vida/somun/standoff aileleri, sarf | `level` |
| **A1** (3D büyük) | Büyük | Modüller, geliştirme kartları, sensörler, röle kartları | `exact` |
| **C1** (kule, 9) | Büyük/karışık | Kablo demetleri, adaptörler, hacimli şeyler | `unmanaged` / `exact` |

> **Kategori bloğu prensibi:** Aynı kategoriyi ardışık kodlara koy. `S1-01…S1-20` = dirençler, `S1-21…S1-35` = kondansatörler. Sistem çökse bile gözünle bulabilirsin. Bu, sistemin **yedeği**dir.

### ABC yerleşimi
- **Sık kullandıkların göz hizasında.** En çok elini attığın 20 çekmece belliyse onlar en erişilir yerde olsun.
- **A sınıfı (pahalı IC/MCU) ESD poşetinde**, kapalı çekmecede, ışıktan uzak.
- Nadir kullanılan / hacimli şeyler en alt ve en üst raflara.

---

## 3. QR Etiketleri

### 3.1 URL kısa olmalı

QR'ın 15-20 mm'de okunabilmesi için içeriği kısa tutmak şart. Uzun URL → yoğun QR → telefon okuyamaz.

```
❌  https://envanter.benimuzunalanadim.com/locations/S1-07     (49 karakter, QR v4+)
✅  https://d.<domain>/l/S1-07                                 (~24 karakter, QR v2)
```

**Yapılacak:** Mevcut domainine tek harfli bir subdomain aç (`d.` veya `e.`), path `/l/<kod>`.
`tenants.settings.qr_base_url` alanına yaz. Etiket üreteci bunu kullanır.

### 3.2 Etiket tasarımı

```
┌──────────────────────────────┐
│  ██▀▀██                      │   ← QR (12-15 mm kare)
│  ▀█▄▄█▀      S1-07           │   ← insan-okunur kod, KALIN, ≥10pt
│  ██  ██      · direnç        │   ← opsiyonel kategori ipucu (küçük, gri)
└──────────────────────────────┘
        38 mm × 21 mm
```

- **İnsan-okunur kod zorunlu.** QR yıpranırsa/silinirse elle girebilmelisin.
- Kategori ipucu opsiyonel ve **soluk** — çünkü içerik değişebilir, kod değişmez.
- Standart A4 etiket sayfası: 38×21 mm, 5 sütun × 13 satır = **65 etiket/sayfa**.
- 217 göz → **4 sayfa**. Tek oturumda biter.

### 3.3 Etiket malzemesi

| ❌ Kullanma | ✅ Kullan |
|---|---|
| **Direkt termal** (senin BT'li mini yazıcı) — zaten QR basmıyor, ayrıca garaj sıcağında (yazın 45-55°C) **kararır/solar** | **A4 lazer/mürekkep etiket sayfası** + üzerine şeffaf koli bandı. Ucuz, dayanıklı, QR net. |
| | **Daha iyisi: etiket yuvası.** 3D çekmecelerinin ön yüzüne kağıt kart kaydırılan bir yuva (10×25 mm, 0.5 mm boşluk) modelle. Yapıştırıcı yok, artık yok, değiştirmesi 2 saniye. |

Mevcut BT'li mini etiket makinesini **çöpe atma** — konum etiketi için uygun değil ama parça poşetlerini (ESP32 poşeti, ödünç verilen kutu) işaretlemek için hâlâ işe yarar.

---

## 4. 3D Baskı Notları

| Konu | Karar |
|---|---|
| **Malzeme** | Yeni baskılar **PETG**. PLA'nın cam geçişi ~55-60°C; kapalı garaj yazın oraya yaklaşır → çekmeceler sıkışır/eğrilir. Mevcut PLA çekmeceleri kullan ama yaz sonunda kontrol et. |
| **Etiket yuvası** | Ön yüze ekle. En yüksek getirili tek tasarım değişikliği. |
| **Bölme ayracı** | A1 (büyük) çekmecelerine ayraç bas → tek çekmecede 2-4 SKU. Adresi `A1-05-b` olur. Şema bunu destekliyor (`parent_id`). |
| **Baskı bütçesi** | Eksik oldukça bas. "Önce 200 çekmece basayım" tuzağına düşme — envanter girişi hiç başlamaz. |

---

## 5. Migrasyon Planı (envanteri sisteme sokma)

### 5.1 Tek dokunuş prensibi
Bir parçayı **bir kez** eline al, o sırada hepsini bitir:
`tanımla → SKU ver → çekmeceye koy → sisteme gir → etiketle`

İki turda yapma. İkinci tur asla gelmez.

### 5.2 Sıra

| Adım | Süre | İş |
|---|---|---|
| **0** | 30 dk | **Başlangıç metriği:** 5 parça seç, bulma sürelerini kronometreyle ölç. Not al. Bu senin "öncesi" verin. |
| **1** | 3-4 sa | **Ayıklama:** AT / KARANTİNA / SAKLA. Envanterin %20-40'ı çöp çıkacak. Karantina sisteme **girmez**. |
| **2** | 2-3 sa | **Kaba tasnif:** 10 büyük kutu, sadece ana kategori. Sıralama yok, sayım yok. |
| **3** | 1 sa | **Etiketleri bas ve yapıştır.** 217 göz, 4 sayfa. Parça girmeden önce konumlar hazır olmalı. |
| **4** | ~15-22 sa | **Sprintler:** 90 dakikalık seanslar. Her seansta **TEK kutu**. Bitmeden diğerine geçme. |
| **5** | 30 dk | **Bitiş metriği:** aynı 5 parçayı tekrar ölç. |

### 5.3 Gerçekçi hız
- Yeni SKU (AI tanıma ile): ~1-1.5 dk/parça → **~40-60 parça/saat**
- Yeni SKU (elle): ~2-3 dk/parça → ~25-30/saat
- Mevcut SKU'ya konum/miktar ekleme: ~30 sn → 100+/saat

**300 farklı SKU → ~10-15 sprint ≈ 7 hafta (haftada 2 sprint).**
Bunu baştan kabul et. "Bir hafta sonunda biter" beklentisi projeyi öldürür.

### 5.4 Motivasyon taktiği
İlk sprintte **en çok kullandığın kategoriyi** gir (muhtemelen modüller/sensörler — A1 kabini).
İlk hafta bitiminde sistem sana gerçekten fayda sağlamaya başlar → devam etme motivasyonu gelir.
Vidalarla başlarsan üçüncü sprintte bırakırsın.

---

## 6. Sürdürülebilirlik Ritüelleri

| Sıklık | Süre | İş |
|---|---|---|
| Her proje sonu | 10 dk | `W1` tezgâhını boşalt, parçaları yerine koy, tüketimi işle |
| Haftalık | 10 dk | Eksikler listesine bak → sipariş listesi hazırla |
| Aylık | 20 dk | **Döngüsel sayım:** rastgele 1 kabin, tam sayım, `audit` hareketi olarak işle. Doğruluk oranını kaydet. |
| 6 aylık | 1 sa | **Ölü stok raporu:** 12 aydır hareketsiz parçalar → AT / KARANTİNA kararı |

Döngüsel sayım, yılda bir topyekûn sayım yapmaktan çok daha etkilidir — veri doğruluğunu sürekli yüksek tutar ve bir seferde 20 dakikadan fazla sürmez.
