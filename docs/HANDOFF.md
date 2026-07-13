# HANDOFF — DEPO

Her oturum sonunda güncellenir: ne yapıldı / ne kaldı / bilinen sorunlar.

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

## Bilinen sorunlar / notlar
- `stock_audit`: istemci offline optimistik ledger kaydı ÜRETMEZ; sonuç sync turunda
  yansır (drift'e karşı sunucu-yetkili delta — SYNC_PROTOCOL §5.3). moveStock/setLevel
  tam offline-optimistik.
- ZXing scanner chunk'ı büyük (~410KB); yalnızca `/scan`'de tembel yükleniyor, SW cache'liyor.
- `config.php` ve `storage/` git ve deploy `--delete` dışıdır (asla silinmez).
