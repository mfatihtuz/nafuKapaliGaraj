# CLAUDE.md — DEPO Projesi

Bu dosya Claude Code'un davranış kurallarını tanımlar. Her oturumda okunur.

---

## 1. Proje Kimliği

**Ad:** DEPO
**Ne:** Elektronik parça / atölye envanteri için offline-first, çok kullanıcılı depo yönetim sistemi.
**Kim için:** Önce sahibi (garaj atölyesi, ~250-600 SKU, 217 fiziksel göz). Sonra: aynı derdi yaşayan makerlar/atölyeler (ürünleştirme hedefi var).
**Nerede çalışır:** Hostinger **paylaşımlı hosting** (PHP 8.1+, MySQL 8/MariaDB, Apache + .htaccess). Docker YOK, root YOK, uzun süreli process YOK, WebSocket YOK.

---

## 2. Teknoloji Yığını — SABİT

| Katman | Teknoloji | Neden |
|---|---|---|
| Backend | **Vanilla PHP 8.1+**, PSR-4 autoload, PDO | Paylaşımlı hostingde framework riski (Symfony cache/cron/CLI) yüksek |
| DB | **MySQL 8 / MariaDB 10.6+**, InnoDB, utf8mb4 | Hostinger standardı |
| Frontend | **React 18 + TypeScript + Vite** | Build lokalde, `dist/` sunucuya yüklenir |
| Offline DB | **Dexie.js** (IndexedDB) | Envanterin tam kopyası telefonda |
| Service Worker | **Workbox** (`vite-plugin-pwa`) | Uygulama kabuğu cache |
| QR tarama | **@zxing/browser** | iOS Safari `BarcodeDetector` desteklemiyor |
| QR üretme | **qrcode** (npm) | Etiket basımı, client-side |
| Stil | **Tailwind CSS** | |
| Kimlik | httpOnly cookie + opak session token | JWT'ye gerek yok, tek origin |

**Kütüphane ekleme:** Yeni bağımlılık eklemeden önce sor. Paylaşımlı hostingde `composer` her zaman yok — PHP tarafında **sıfır Composer bağımlılığı** hedefi. Gerekirse `vendor/` lokalde üretilip yüklenir, ama önce kaçınmayı dene.

---

## 3. Anti-Halüsinasyon Protokolü

Bu kurallar pazarlığa kapalıdır.

1. **Uydurma yok.** Bir kütüphanenin API'sinden, bir PHP fonksiyonunun imzasından, Hostinger'ın bir özelliğinden %100 emin değilsen — **dur ve söyle.** "Muhtemelen şöyledir" yazma.
2. **Var olmayan dosyaya referans verme.** Bir dosyayı import etmeden önce var olduğunu doğrula (`ls`, `grep`).
3. **Şemayı doğrula.** SQL yazmadan önce `db/schema.sql`'i oku. Hafızandan sütun adı uydurma.
4. **Emin olmadığında sor.** Kullanıcı belirsizlik toleransı düşük olan biri. Yanlış varsayımla 500 satır yazmaktansa 1 soru sor.
5. **Test edilmemiş kodu "çalışıyor" diye sunma.** "Yazdım, test etmedim" de.
6. **Sürüm uydurma.** `package.json`'a sürüm yazarken tahmin etme; `npm view <pkg> version` çalıştır.

---

## 4. Kod Standartları

### PHP
- `declare(strict_types=1);` her dosyada.
- Namespace: `Depo\`. PSR-4: `src/` → `Depo\`.
- **Her sorgu prepared statement.** String interpolasyonlu SQL = derhal reddedilir.
- **Her sorguda `tenant_id` filtresi.** Multi-tenant izolasyon ihlali = kritik güvenlik hatası. Repository katmanında zorunlu kıl; tenant scope'u atlayan sorgu yazma.
- Hata yönetimi: exception fırlat, `index.php`'de tek noktada yakala, JSON döndür. `die()` / `exit()` yok.
- Zaman: her şey **UTC**, `DATETIME(3)`. Görüntülemede TZ dönüşümü frontend'de.

### TypeScript / React
- `strict: true`. `any` yasak (gerçekten kaçınılmazsa `// eslint-disable` + gerekçe yorumu).
- Fonksiyonel bileşen + hook. Class component yok.
- Sunucu durumu için **TanStack Query** kullanma — bu offline-first bir uygulama; **Dexie live query** (`useLiveQuery`) tek doğruluk kaynağı. UI daima IndexedDB'den okur, asla doğrudan API'den.
- Form elemanı için `<form>` etiketi kullanılabilir (bu bir Artifact değil, gerçek uygulama).

### Genel
- Dosya başına tek sorumluluk. 400 satırı geçen dosyayı böl.
- Yorumlar **Türkçe**, kod (değişken/fonksiyon adları) **İngilizce**.
- Commit: Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`).

---

## 5. Dil Kuralları

Uygulama **çok dilli** olacak (ürünleştirme hedefi). Baştan uygun kur:

- UI metinleri `src/i18n/tr.json`, `src/i18n/en.json`. **Kodda sabit metin yok.**
- Varsayılan dil: `tr`.
- **SKU ve teknik kodlar daima ASCII/İngilizce**: `R-0805-10K-1P`. Türkçe karakter SKU'ya girmez.
- Arama Türkçe karakter duyarsız olmalı: `ç→c, ı→i, ş→s, ğ→g, ü→u, ö→o, İ→i`. Hem MySQL (`utf8mb4_turkish_ci` DEĞİL — `utf8mb4_0900_ai_ci` kullan, aksan duyarsız) hem client tarafında normalize et.

---

## 6. Asla Yapma

| ❌ | Neden |
|---|---|
| Stok miktarını (`qty`) senkronizasyonda LWW ile çözmek | İki cihaz `-1` yaparsa sonuç `-1` olur, `-2` olması gerekirken. Stok **daima** hareket (delta) olarak senkronize edilir. Bkz. `docs/SYNC_PROTOCOL.md`. |
| `stock_transactions` satırı silmek/güncellemek | Ledger append-only. Düzeltme = ters kayıt. |
| Anthropic/LCSC API anahtarını frontend'e koymak | Sunucu tarafı proxy zorunlu. |
| QR koduna parça bilgisi yazmak | QR'da **sadece konum URL'i** olur. Parça değişince etiket yeniden basılmaz. |
| Kullanıcı yüklediği dosyayı web-erişilebilir klasöre koymak | `storage/` webroot dışında; erişim PHP üzerinden yetkilendirilerek. |
| Faz sırasını atlamak | `docs/SPRINT_PLAN.md`. Faz 1 bitmeden Faz 2 yok. |

---

## 7. Oturum Yönetimi

- Her oturum başında: `CLAUDE.md` + ilgili faz dokümanı + `db/schema.sql` oku.
- Her oturum sonunda: `docs/HANDOFF.md` dosyasına ne yapıldı / ne kaldı / bilinen sorunlar yaz.
- Bağlam şişerse `/compact` kullan, sonra `HANDOFF.md`'yi tekrar oku.
- Büyük refactor öncesi commit at.

---

## 8. Kabul Kriteri (her PR/özellik için)

- [ ] Tenant izolasyonu var mı? (başka tenant'ın verisi sızıyor mu?)
- [ ] Offline çalışıyor mu? (uçak modunda test et)
- [ ] Senkronizasyon idempotent mi? (aynı işlemi 2 kez push et, sonuç değişmemeli)
- [ ] Türkçe karakterli arama çalışıyor mu?
- [ ] Mobilde (375px genişlik) kullanılabilir mi? Tek elle?
- [ ] SQL injection riski var mı?
