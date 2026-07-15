# HANDOFF — DEPO

Her oturum sonunda güncellenir: ne yapıldı / ne kaldı / bilinen sorunlar.

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
