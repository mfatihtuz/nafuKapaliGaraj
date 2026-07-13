# AI_INTAKE — Fotoğraftan Parça Tanıma (Faz 2)

## 1. Neden bu, barkod değil?

Tedarik kaynakları: Türkiye (Direnc.net, Robotistan), hurda/söküm, LCSC/AliExpress.

- TR tedarikçileri **standart 2D barkod (ECIA DataMatrix) basmıyor** → otomatik giriş yok.
- Hurda/sökümde **hiç barkod yok**.
- LCSC'de var ama payı küçük.

→ Barkod entegrasyonunun getirisi düşük. **Fotoğraftan tanıma** ise her üç kaynakta da çalışır, özellikle sökümde (çipin üstündeki markingi okumak).

---

## 2. Akış

```
[Fotoğraf çek]  ──►  POST /api/ai/identify   ──►  Claude (vision)
                          │                            │
                          │  ◄─────── yapılandırılmış JSON ─────┘
                          ▼
              Intake formu ÖN-DOLDURULUR
                          │
              Kullanıcı GÖZDEN GEÇİRİR + düzeltir   ← ZORUNLU adım
                          │
                    Konum tara → Kaydet
```

> **Kritik:** AI önerisi **asla otomatik kaydedilmez.** Kullanıcı onayı zorunlu. Model markingi yanlış okuyabilir; yanlış SKU, envanteri sessizce zehirler.
> Formda AI'dan gelen alanlar **görsel olarak işaretlensin** (örn. soluk sarı arka plan) → kullanıcı neyin tahmin olduğunu bilsin.

---

## 3. Sunucu Tarafı (PHP)

```php
// src/Service/AiIdentifyService.php
// API anahtarı config.php'de. ASLA frontend'e gitmez.

$payload = [
    'model'      => 'claude-sonnet-4-6',
    'max_tokens' => 1200,
    'system'     => $systemPrompt,     // aşağıda
    'messages'   => [[
        'role' => 'user',
        'content' => [
            ['type' => 'image', 'source' => [
                'type' => 'base64', 'media_type' => 'image/jpeg', 'data' => $b64
            ]],
            ['type' => 'text', 'text' => $userPrompt],   // aşağıda
        ],
    ]],
];
```

**Görsel ön işleme (zorunlu):**
- İstemcide fotoğrafı **1600px uzun kenara küçült**, JPEG q=0.85. Ham 12 MP göndermek hem yavaş hem pahalı.
- Mümkünse kullanıcıya "yakın çek, marking okunsun" ipucu göster.

**Maliyet kontrolü:**
- `ai_calls` sayacı tut (tenant başına aylık limit).
- Aynı `sha256`'lı görsel tekrar gönderilirse cache'den dön.

---

## 4. System Prompt

```
Sen bir elektronik parça tanımlama asistanısın. Sana bir elektronik/mekanik
parçanın fotoğrafı verilir. Görevin parçayı tanımlamak ve YAPILANDIRILMIŞ JSON
döndürmektir.

KURALLAR:
1. SADECE JSON döndür. Markdown kod bloğu, açıklama, önsöz YOK.
2. Emin olmadığın alanı null bırak. TAHMİN UYDURMA.
3. Her alan için 0-1 arası bir güven skoru (confidence) ver.
4. Gövde üzerindeki markingi (harfler/rakamlar) OLDUĞU GİBİ oku ve
   `visible_marking` alanına yaz — yorumlamadan.
5. Direnç renk kodu görünüyorsa çöz ve değeri hesapla.
6. SMD direnç/kondansatör üzerindeki 3-4 haneli kodu çöz (örn. "103" = 10 kΩ).
7. Birden çok parça görünüyorsa en belirgin/merkezi olanı tanımla ve
   `multiple_parts: true` işaretle.

ÇIKTI ŞEMASI:
{
  "category_code": "R|C|L|XTAL|D|LED|Q|VREG|OPA|LOG|MCU|DRV|OPTO|DEV|SNS|RF|DSP|PWR|RLY|SW|POT|CON|MOT|CBL|BAT|MEC|3DP|SRF|TOOL|null",
  "name": "insan-okunur kısa ad (Türkçe)",
  "mpn": "üretici parça numarası veya null",
  "manufacturer": "üretici veya null",
  "visible_marking": "gövdede okunan ham metin veya null",
  "attributes": { "anahtar": "değer" },
  "package": "0805 | SOT-23 | TO-220 | ... | null",
  "tags": ["türkçe", "ingilizce", "arama", "etiketleri"],
  "suggested_count_mode": "exact|level|unmanaged",
  "confidence": { "category_code": 0.0, "mpn": 0.0, "attributes": 0.0 },
  "multiple_parts": false,
  "notes": "belirsizlik varsa kullanıcıya not (Türkçe), yoksa null"
}

Öznitelik anahtarları kategoriye göre değişir:
  R    → value, package, tolerance, power
  C    → value, package, voltage, dielectric
  LED  → color, package
  Q    → subtype, package
  MCU  → family, package
  CON  → family, pins, gender
  MEC  → subtype, spec, material
```

## 5. User Prompt

```
Bu parçayı tanımla.

Bağlam (yardımcı olabilir):
- Kullanıcının envanteri: hobi elektroniği + endüstriyel otomasyon + 3D baskı.
- Parça Türkiye'den (Direnc.net, Robotistan), Çin'den (LCSC/AliExpress) veya
  sökülmüş eski bir cihazdan gelmiş olabilir.
- Söküm parçalarda gövde kirli/aşınmış olabilir; markingi dikkatli oku.

Sadece JSON döndür.
```

---

## 6. İstemci Tarafı

```ts
// Yanıtı işleme
const res = await fetch('/api/ai/identify', { method: 'POST', body: form });
const data = await res.json();

// SKU'yu AI değil, KATEGORİ ŞABLONU üretir:
const category = await db.categories.where('code').equals(data.category_code).first();
const sku = renderSkuTemplate(category.sku_template, data.attributes, data.mpn);
// 'R-{package}-{value}-{tolerance}' + {package:'0805', value:'10K', tolerance:'1P'}
//   → 'R-0805-10K-1P'
```

> **SKU'yu modele ürettirme.** Şablon motoruyla deterministik üret. Aksi halde
> aynı parça iki farklı SKU ile iki kez girilir ve mükerrer kayıt oluşur.

### Düşük güven davranışı
```
confidence.category_code < 0.6  →  kategoriyi ön-doldurma, kullanıcıya seçtir
confidence.mpn < 0.7            →  MPN alanını "?" ile işaretle
multiple_parts === true         →  "Tek parça fotoğrafla" uyarısı göster
```

### Mükerrer kontrolü
Kaydetmeden önce: `sku` veya `mpn` katalogda var mı?
```
→ "Bu parça zaten var: S1-07'de, 42 adet. Oraya mı eklensin?"
   [Oraya ekle]  [Yeni konum]  [Yeni parça olarak kaydet]
```
Bu tek kontrol, envanterin en yaygın kirlenme yolunu kapatır.

---

## 7. MPN Zenginleştirme (opsiyonel, AI'dan sonra)

MPN tespit edildiyse: `GET /api/lookup/mpn?q=<mpn>`
→ Sunucu LCSC veya Octopart/Nexar API'sine sorar → paket, parametreler, datasheet URL, ürün fotoğrafı.

**Uyarı:** Bu API'lerin erişim koşullarını ve fiyatlandırmasını **kullanmadan önce doğrula**. Anahtarsız/limitli olabilir. Faz 2'nin sonunda, opsiyonel bir iyileştirme olarak ele al. Çalışmazsa AI + elle giriş zaten yeterli.

---

## 8. Ne Zaman AI Kullanma

| Durum | Yöntem |
|---|---|
| Söküm çip, marking okunuyor | ✅ AI |
| Karışık direnç poşeti, renk kodu var | ✅ AI |
| Yeni sipariş, kutunun üstünde yazıyor | ❌ Elle yaz, daha hızlı |
| Aynı parçadan 20. kez giriyorsun | ❌ Katalogdan seç |
| Vida/somun | ❌ Elle (kumpasla ölç) — AI M3 ile M3.5'i ayırt edemez |

**AI bir hızlandırıcıdır, bir otorite değil.** Sistem AI olmadan da tam çalışmalı.
