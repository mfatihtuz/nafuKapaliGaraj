# ARCHITECTURE — DEPO

## 1. Üst Düzey

```
┌─────────────────────── TELEFON / PC (istemci) ───────────────────────┐
│                                                                       │
│   React + TS (Vite)                                                   │
│        │                                                              │
│        │  UI DAİMA BURADAN OKUR  ◄─────────────┐                      │
│        ▼                                       │                      │
│   ┌──────────────────────────────────────┐     │                      │
│   │  IndexedDB (Dexie)                   │     │                      │
│   │   • parts, locations, categories     │     │  useLiveQuery        │
│   │   • stock (türetilmiş görünüm)       │     │                      │
│   │   • outbox  ← bekleyen işlemler      │     │                      │
│   │   • meta.sync_cursor                 │     │                      │
│   └──────────────────────────────────────┘     │                      │
│        │                       ▲               │                      │
│        │ push (outbox)         │ pull          │                      │
│        ▼                       │                                      │
│   ┌──────────────────────────────────────┐                            │
│   │  Sync Engine (Service Worker + BG)   │  ◄── online olunca tetikler│
│   └──────────────────────────────────────┘                            │
└──────────────────────────┬────────────────────────────────────────────┘
                           │  HTTPS / JSON
                           ▼
┌──────────────────── HOSTINGER (paylaşımlı) ──────────────────────────┐
│  public_html/depo/                                                    │
│    ├── index.php        ← tek giriş noktası (front controller)        │
│    ├── .htaccess        ← tüm istekleri index.php'ye yönlendir        │
│    └── assets/          ← Vite build çıktısı (dist)                   │
│  ../depo_private/       ← WEBROOT DIŞI                                │
│    ├── src/             ← PHP kaynak (Depo\ namespace)                │
│    ├── storage/         ← yüklenen dosyalar (datasheet, foto)         │
│    ├── config.php       ← DB kimlik bilgileri, API anahtarları        │
│    └── backups/         ← otomatik JSON/SQL yedekler                  │
│  MySQL                                                                │
└───────────────────────────────────────────────────────────────────────┘
```

**Altın kural:** UI hiçbir zaman doğrudan API'den okumaz. Daima IndexedDB'den okur. API sadece sync motorunun konuştuğu yerdir. Bu sayede uygulama internet olsun olmasın **aynı hızda** çalışır.

---

## 2. Klasör Yapısı

```
depo/
├── CLAUDE.md
├── docs/
├── db/
│   ├── schema.sql
│   ├── seed.sql
│   └── migrations/
│       └── 001_init.sql
├── api/                          # PHP backend
│   ├── public/
│   │   ├── index.php             # front controller
│   │   └── .htaccess
│   ├── src/
│   │   ├── Core/
│   │   │   ├── Router.php
│   │   │   ├── Request.php
│   │   │   ├── Response.php
│   │   │   ├── Db.php            # PDO singleton
│   │   │   └── Uuid.php          # UUIDv7 üretici
│   │   ├── Middleware/
│   │   │   ├── AuthMiddleware.php
│   │   │   └── TenantMiddleware.php   # tenant_id'yi context'e koyar
│   │   ├── Repository/
│   │   │   ├── BaseRepository.php     # HER sorguya tenant_id ekler
│   │   │   ├── PartRepository.php
│   │   │   ├── LocationRepository.php
│   │   │   ├── StockRepository.php
│   │   │   └── ChangeLogRepository.php
│   │   ├── Service/
│   │   │   ├── SyncService.php        # ← projenin kalbi
│   │   │   ├── StockService.php       # hareket uygula, stok türet
│   │   │   ├── AiIdentifyService.php  # Faz 2
│   │   │   └── AttachmentService.php  # Faz 2
│   │   └── Controller/
│   │       ├── AuthController.php
│   │       ├── SyncController.php
│   │       ├── AttachmentController.php
│   │       └── AiController.php
│   └── config.example.php
├── web/                          # React frontend
│   ├── src/
│   │   ├── db/
│   │   │   ├── dexie.ts          # şema, tablolar
│   │   │   └── queries.ts        # useLiveQuery hook'ları
│   │   ├── sync/
│   │   │   ├── engine.ts         # pull/push döngüsü
│   │   │   ├── outbox.ts         # işlem kuyruğu
│   │   │   └── apply.ts          # sunucudan gelen değişiklikleri uygula
│   │   ├── pages/
│   │   │   ├── Scan.tsx
│   │   │   ├── Location.tsx
│   │   │   ├── Search.tsx
│   │   │   ├── PartDetail.tsx
│   │   │   ├── Intake.tsx
│   │   │   ├── Labels.tsx
│   │   │   └── Settings.tsx
│   │   ├── components/
│   │   ├── lib/
│   │   │   ├── scanner.ts        # ZXing sarmalayıcı
│   │   │   ├── sku.ts            # SKU şablon motoru
│   │   │   ├── normalize.ts      # Türkçe karakter normalizasyonu
│   │   │   └── qr.ts
│   │   └── i18n/
│   │       ├── tr.json
│   │       └── en.json
│   ├── vite.config.ts
│   └── package.json
└── scripts/
    ├── deploy.sh                 # build + FTP/rsync yükleme
    └── backup.php                # cron: günlük JSON yedek
```

---

## 3. Kimlik Doğrulama & Multi-Tenant

### Auth
- Kayıt: e-posta + parola. Parola: `password_hash($p, PASSWORD_ARGON2ID)`.
- Giriş: opak session token (32 byte random, hex) → `sessions` tablosu.
- Cookie: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=60*60*24*90`.
- **JWT kullanma.** Tek origin, tek sunucu — gereksiz karmaşıklık ve iptal edilemezlik sorunu.
- Offline'da: son başarılı auth'un `tenant_id`'si IndexedDB'de tutulur. Uygulama offline'da çalışmaya devam eder; sync başarısız olursa "çevrimdışı" rozeti gösterilir.

### Tenant izolasyonu — KRİTİK
```php
// BaseRepository — her sorgu buradan geçer
abstract class BaseRepository {
    public function __construct(
        protected PDO $db,
        protected string $tenantId,   // ← middleware'den gelir, ASLA istemciden değil
    ) {}

    protected function scoped(string $sql): string {
        // Alt sınıflar :tenant_id parametresini KULLANMAK ZORUNDA.
        // Kod incelemesinde: tenant_id içermeyen SELECT/UPDATE/DELETE = red.
    }
}
```

**Test zorunlu:** İki tenant oluştur, A'nın token'ıyla B'nin `part_id`'sine erişmeye çalış → 404 dönmeli (403 değil; varlığı bile sızdırma).

---

## 4. API Yüzeyi

Hepsi `POST`/`GET`, JSON. Base: `/api`.

| Endpoint | Metod | Açıklama |
|---|---|---|
| `/api/auth/register` | POST | |
| `/api/auth/login` | POST | Cookie set eder |
| `/api/auth/logout` | POST | |
| `/api/auth/me` | GET | Kullanıcı + tenant bilgisi |
| **`/api/sync/pull`** | GET | `?since=<seq>&limit=500` → değişiklikler + yeni cursor |
| **`/api/sync/push`** | POST | `{ops: [...]}` → uygulanan `op_id` listesi |
| `/api/sync/bootstrap` | GET | İlk kurulumda tüm veriyi tek seferde çek |
| `/api/attachments` | POST | Dosya yükleme (multipart) — Faz 2 |
| `/api/attachments/:id` | GET | Yetkilendirilmiş dosya servisi — Faz 2 |
| `/api/ai/identify` | POST | Fotoğraf → parça önerisi — Faz 2 |
| `/api/lookup/mpn` | GET | MPN → parametre/datasheet — Faz 2 |

**Sadece 3 endpoint (pull/push/bootstrap) tüm CRUD'u karşılıyor.** Ayrı `POST /parts`, `PUT /parts/:id` gibi endpoint'ler **yok** — çünkü her yazma offline'da olabilmeli, yani her yazma outbox'tan geçmeli. Tek yol, tek kod patikası, tek hata kaynağı.

---

## 5. Dosya Depolama (Faz 2)

Hostinger paylaşımlı hostingde disk kotası var. Dikkatli ol:

```
storage/{tenant_id}/{part_id}/
    orig_{uuid}.jpg      # orijinal (max 2000px'e küçültülmüş)
    thumb_{uuid}.jpg     # 200px küçük resim
    ds_{uuid}.pdf        # datasheet
```

- Yükleme sırasında sunucuda **GD ile yeniden boyutlandır**. Ham 12 MP telefon fotoğrafı saklama.
- Hedef: fotoğraf başına < 300 KB, küçük resim < 20 KB.
- Datasheet'ler: **indirme yerine URL sakla.** PDF'i sadece kullanıcı açıkça isterse arşivle (disk tasarrufu).
- `attachments` tablosunda `sha256` tut → aynı dosya iki kez yüklenmesin.
- Erişim: `GET /api/attachments/:id` → tenant kontrolü → `readfile()` + doğru `Content-Type`. **Doğrudan URL ile erişim yok.**

---

## 6. Yedekleme

Hostinger cron (günlük 03:00):
```
php /home/uXXXX/depo_private/scripts/backup.php
```
- Tüm tenant verisini JSON olarak dışa aktar → `backups/depo_YYYY-MM-DD.json.gz`
- Son 30 günü tut, eskisini sil.
- Ayrıca uygulama içinde **manuel "Dışa Aktar"** butonu (kullanıcı kendi verisini indirsin). Ürünleştirme için de gerekli (veri taşınabilirliği).

---

## 7. Performans Hedefleri

| İşlem | Hedef |
|---|---|
| Arama sonucu görünmesi | **< 50 ms** (IndexedDB, offline) |
| QR tarama → konum ekranı | **< 1 sn** |
| `-1` butonuna basma → UI güncellenmesi | **< 16 ms** (optimistik, ağ beklemez) |
| Uygulama açılışı (cache'li) | **< 1.5 sn** |
| Tam bootstrap (600 SKU + 220 konum) | < 5 sn, < 500 KB |

600 SKU'luk bir envanter IndexedDB'de birkaç yüz KB. Tamamını telefonda tutmak sorun değil — **sayfalama yapma, hepsini yükle.**

---

## 8. Dağıtım

```bash
# scripts/deploy.sh
cd web && npm run build          # → web/dist/
rsync -avz web/dist/  hostinger:public_html/depo/
rsync -avz api/src/   hostinger:depo_private/src/
rsync -avz api/public/ hostinger:public_html/depo/
```
- `.htaccess`: statik dosya yoksa → `index.php` (SPA fallback + API routing).
- `config.php` **asla** git'e girmez. `.gitignore`'a ekle.
