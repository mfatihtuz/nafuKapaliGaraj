# SPRINT_PLAN — DEPO

Her madde bir Claude Code oturumuna karşılık gelir (yaklaşık). Sırayı bozma.

**Faz kilidi:** Bir faz bitmeden sonraki fazın kodu yazılmaz. Özellikle **Faz 1 bitince kodlamayı DURDUR ve garajı envanterlemeye başla.** Faz 2-4 boş bir veritabanının üstünde işe yaramaz.

---

## FAZ 0 — İskelet (2-3 oturum)

- [ ] **0.1** Repo yapısı: `api/`, `web/`, `db/`, `scripts/`. `.gitignore` (config.php, node_modules, dist).
- [ ] **0.2** PHP: front controller + Router + PDO + JSON Response + hata yakalama. `GET /api/health` → `{ok:true}`.
- [ ] **0.3** `db/schema.sql` + `db/seed.sql` çalıştır. Hostinger phpMyAdmin'den içe aktar.
- [ ] **0.4** Auth: register / login / logout / me. Argon2id + httpOnly cookie session.
- [ ] **0.5** `TenantMiddleware` + `BaseRepository` (tenant scope zorunlu).
- [ ] **0.6** Vite + React + TS + Tailwind + PWA plugin iskeleti. `npm run build` → `dist/`.
- [ ] **0.7** `scripts/deploy.sh` — Hostinger'a yükleme. **Uçtan uca test: canlıda `/api/health` çalışıyor mu?**

**Çıkış kriteri:** Hostinger'da açılan boş bir React sayfası + giriş yapılabilen bir API.

---

## FAZ 1 — MVP (6-9 oturum) ⭐ ASIL İŞ

- [ ] **1.1** `db/dexie.ts` — IndexedDB şeması (parts, locations, categories, stock, transactions, outbox, meta).
- [ ] **1.2** `SyncService` (PHP): `bootstrap`, `pull`, `push`. `change_log` + `sync_ops` idempotency.
      → `docs/SYNC_PROTOCOL.md`'yi baştan sona uygula. Kestirme yok.
- [ ] **1.3** `sync/engine.ts` (TS): outbox, pull/push döngüsü, online/offline tetikleyiciler, çevrimdışı rozeti.
- [ ] **1.4** **SYNC TESTLERİ** (`SYNC_PROTOCOL.md` §8). Özellikle Test 3 (delta toplanabilirliği) ve Test 5 (idempotency). **Bunlar geçmeden devam etme.**
- [ ] **1.5** `StockService` (PHP): hareket uygula → `stock` türet. `exact` / `level` / `unmanaged` modları.
- [ ] **1.6** `/l/:code` Konum ekranı. Büyük kod, parça listesi, `+/−`, seviye butonları. Mobil-öncelikli, tek elle.
- [ ] **1.7** `/scan` Tarayıcı ekranı. ZXing + kamera izni + manuel kod girişi fallback'i.
- [ ] **1.8** `/search` Arama. Türkçe karakter normalizasyonu. Sonuç kartında **konum kodu en büyük eleman.**
- [ ] **1.9** `/intake` Hızlı giriş. Kategori → dinamik öznitelik formu → SKU şablon motoru → konum tara → kaydet. Seri giriş modu. Mükerrer kontrolü.
- [ ] **1.10** `/parts/:id` Parça detayı: öznitelikler, konumlar, hareket geçmişi, sayım modu değiştirme, min stok.
- [ ] **1.11** `/labels` Etiket üreteci: konum aralığı seç → QR + kod → A4 print CSS. **Test: bas, kes, yapıştır, telefonla oku.**
- [ ] **1.12** `/settings`: kategori/öznitelik yönetimi, sayım modu varsayılanları (toplu değiştirme), JSON export/import, dil.
- [ ] **1.13** PWA cilası: manifest, ikon, "ana ekrana ekle", offline shell. **Uçak modunda tam test.**

**Çıkış kriteri:**
- Uçak modunda parça arayabiliyor, konum tarayabiliyor, stok düşebiliyorsun.
- Online olunca hepsi kayıpsız senkronize oluyor.
- 217 etiket basılı ve yapıştırılmış.

### ⛔ BURADA DUR
**Envanter girişine başla.** Haftada 2 × 90 dk sprint. `docs/PHYSICAL_LAYOUT.md` §5.
En az **100 SKU** girmeden Faz 2'ye geçme. Gerçek veriyle çalışmak, hangi özelliğin gerçekten eksik olduğunu gösterir — tahminlerin değil.

---

## FAZ 2 — Giriş Hızlandırma (3-4 oturum)

- [ ] **2.1** `AttachmentService`: fotoğraf/PDF yükleme, GD ile boyutlandırma, thumbnail, sha256 dedup, webroot-dışı depolama, yetkilendirilmiş servis.
- [ ] **2.2** Çekmece fotoğrafı: konum ekranından fotoğraf çek → arama sonuçlarında göster. (Sürpriz derecede faydalı.)
- [ ] **2.3** `AiIdentifyService` + `/intake` entegrasyonu. `docs/AI_INTAKE.md`. Güven skoru görselleştirme, onay zorunlu.
- [ ] **2.4** Eksikler listesi: `min_qty` altı + `level='empty'` → kopyalanabilir alışveriş listesi.
- [ ] **2.5** (opsiyonel) MPN → LCSC/Octopart zenginleştirme. **Önce API erişimini doğrula.**

---

## FAZ 3 — Modüller (4-6 oturum)

- [ ] **3.1** Projeler + BOM. CSV/KiCad BOM içe aktarma. Ham satır → parça eşleştirme (fuzzy).
- [ ] **3.2** "Bu projeyi yapabilir miyim?" → eksik listesi + eksikler için sipariş listesi.
- [ ] **3.3** Proje sanal konumu: projeye parça çek (`transfer`), proje bitince artanı iade et.
- [ ] **3.4** Ödünç takibi: kişi başına `LOAN-*` sanal konumu, vade, geciken uyarısı, iade akışı.
- [ ] **3.5** Tedarikçiler + fiyat geçmişi. Parça başına birden çok tedarikçi/URL.
- [ ] **3.6** Sipariş (PO): taslak → sipariş edildi → geldi. Gelen siparişi `IN` konumuna, oradan çekmecelere dağıt.

---

## FAZ 4 — Olgunluk & Ürünleştirme (5+ oturum)

- [ ] **4.1** Döngüsel sayım modülü: kabin seç → sayım ekranı → fark raporu → `audit` hareketleri → **doğruluk oranı KPI'ı**.
- [ ] **4.2** Ölü stok raporu (12 ay hareketsiz) + ABC dağılım raporu.
- [ ] **4.3** `GET /api/sync/checksum` + otomatik onarım (self-healing).
- [ ] **4.4** Otomatik yedekleme cron + uygulama içi "Verimi indir".
- [ ] **4.5** Ağırlıkla sayım: parça başına `unit_weight_g`, "tart ve say" ekranı.
- [ ] **4.6** LED bulucu: ESP32 + WS2812. Arama sonucunda çekmece yanar. HTTP endpoint veya MQTT → Home Assistant.
- [ ] **4.7** Ürünleştirme: kayıt/onboarding akışı, boş-durum rehberi (kendi kabinlerini tanımlama sihirbazı), plan limitleri, ödeme.

---

## Faz 1'de Kesinlikle Yapılmayacaklar

Bunlar cazip, hepsi ertelenir:

- Rol/yetki matrisi (tek kullanıcı yeter)
- Çoklu dil arayüzü **çevirileri** (altyapı kurulur, `en.json` boş kalabilir)
- Raporlama/grafik
- Tedarikçi entegrasyonu
- E-posta bildirimleri
- Karanlık mod (Tailwind ile 20 dk, ama Faz 1'de değil)

---

## Oturum Şablonu (her Claude Code oturumu için)

```
1. CLAUDE.md oku.
2. docs/HANDOFF.md oku (önceki oturumda ne kaldı?)
3. Bu oturumun maddesini SPRINT_PLAN.md'den seç.
4. İlgili dokümanı oku (şema değişecekse db/schema.sql, sync ise SYNC_PROTOCOL.md).
5. PLAN SUN, onay bekle.
6. Uygula. Test et.
7. Commit.
8. docs/HANDOFF.md güncelle: ne yapıldı / ne kaldı / bilinen sorunlar.
```
