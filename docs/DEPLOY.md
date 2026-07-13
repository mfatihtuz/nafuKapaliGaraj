# DEPLOY — DEPO'yu Hostinger'a Kurma

Hedef: `https://nafuhome.mftyazilim.com/depo_yonetimi/`

> Not: Bu depo, otomasyon ortamından **doğrudan FTP ile yükleme yapamaz** (ağ
> politikası port 21'i ve dış siteleri engelliyor). Aşağıdaki adımları kendi
> makinenden veya Hostinger panelinden uygula. `scripts/deploy.sh` tek komutla
> build + yükleme yapar.

---

## 1. Veritabanı (hPanel → Databases → MySQL)

1. Yeni bir MySQL veritabanı + kullanıcı oluştur. Not al:
   - Host (genelde `localhost`)
   - DB adı, kullanıcı, parola
2. phpMyAdmin'i aç, bu veritabanını seç, **Import** ile sırayla çalıştır:
   - `db/schema.sql`
   - `db/seed.sql`  (217 göz + kategoriler + öznitelik şablonları)
3. seedّdeki varsayılan giriş:
   - E-posta: `fatih@ornek.com`
   - Parola: `degistir123`  → **İlk girişten sonra değiştir.**
   - (E-postayı da değiştirmek istersen `users` tablosundan güncelle.)

## 2. config.php (gizli — git'e girmez)

Sunucuda `public_html/depo_yonetimi/private/config.php` oluştur.
`api/config.example.php`'yi temel al ve `db` bölümünü doldur:

```php
'db' => [
  'host' => 'localhost',
  'port' => 3306,
  'name' => 'uXXXXXXXXX_depo',
  'user' => 'uXXXXXXXXX_depo',
  'pass' => 'DB_PAROLASI',
  'charset' => 'utf8mb4',
],
'app' => [ 'base_path' => '/depo_yonetimi', 'domain' => 'nafuhome.mftyazilim.com', 'env' => 'production' ],
```

## 3. Dosyaları yükle

### Seçenek A — script (önerilen)
Kendi makinenden (node/npm + lftp kurulu):
```bash
export FTP_HOST=145.14.156.26
export FTP_USER='u398313596.nafuhome.mftyazilim.com'
export FTP_PASS='********'
bash scripts/deploy.sh
```
Script `web/`'i build eder, sunucu yerleşimini hazırlar ve yükler.
`config.php` ve `storage/` **silinmez** (mirror `--delete` kullanmaz).

### Seçenek B — elle (File Manager / FileZilla)
Önce `cd web && npm ci && npm run build`. Sonra:

| Yerel | Sunucu |
|---|---|
| `web/dist/*` | `public_html/depo_yonetimi/` |
| `api/public/index.php` | `public_html/depo_yonetimi/index.php` |
| `api/public/.htaccess` | `public_html/depo_yonetimi/.htaccess` |
| `api/src/*` | `public_html/depo_yonetimi/private/src/` |
| `api/config.example.php` | `public_html/depo_yonetimi/private/config.php` (düzenle) |

`private/` içine bir `.htaccess` koy (`Require all denied`) — kaynak web'den okunmasın.

## 4. Doğrula

```bash
curl -s https://nafuhome.mftyazilim.com/depo_yonetimi/api/health
# Beklenen: {"ok":true,"db":true,"time":"...","app":"depo","version":"1.0.0"}
```
Sonra tarayıcıda `https://nafuhome.mftyazilim.com/depo_yonetimi/` → giriş yap.

## 5. QR taban URL'i

seed `tenants.settings.qr_base_url` = `https://nafuhome.mftyazilim.com/depo_yonetimi/l/`.
Etiketler bunu kullanır. İstersen kısa bir subdomain (`d.` gibi) açıp güncelle
(QR yoğunluğu düşer — PHYSICAL_LAYOUT §3.1).

## 6. (Opsiyonel) Günlük yedek — cron

hPanel → Cron Jobs → günlük 03:00:
```
php /home/uXXXXXXXXX/domains/nafuhome.mftyazilim.com/public_html/depo_yonetimi/private/scripts/backup.php
```
(`scripts/backup.php`'yi `private/scripts/` altına koy. `backups/` webroot dışıdır.)

---

## Kurulum sonrası kontrol listesi (CLAUDE.md §8)

- [ ] `/api/health` → `db:true`
- [ ] Giriş yapılabiliyor, çıkış yapılabiliyor
- [ ] Uçak modunda arama/konum/stok düşme çalışıyor (offline)
- [ ] Online olunca kayıpsız senkron (aynı op 2× → tek değişiklik)
- [ ] Türkçe karakterli arama (`direnc` → `Direnç`)
- [ ] Mobilde 375px, tek elle
- [ ] Varsayılan parola değiştirildi
