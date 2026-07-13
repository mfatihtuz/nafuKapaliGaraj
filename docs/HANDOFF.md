# HANDOFF — DEPO

Her oturum sonunda güncellenir: ne yapıldı / ne kaldı / bilinen sorunlar.

---

## Oturum: Proje yerleşimi (FAZ 0.1 — kısmi)

### Ne yapıldı
- Claude Code proje spesifikasyon paketi repoya yerleştirildi:
  - `CLAUDE.md` → kök
  - `README.md` → kök
  - `docs/` → PRD, ARCHITECTURE, SYNC_PROTOCOL, PHYSICAL_LAYOUT, AI_INTAKE, SPRINT_PLAN
  - `db/` → `schema.sql`, `seed.sql`
- `ARCHITECTURE.md §2`'deki klasör yapısı iskelet olarak kuruldu (boş dizinler `.gitkeep` ile):
  - `api/public`, `api/src/{Core,Middleware,Repository,Service,Controller}`
  - `web/src/{db,sync,pages,components,lib,i18n}`
  - `db/migrations`, `scripts/`
- `.gitignore` eklendi (`config.php`, `node_modules`, `dist`, `storage/`, `backups/`, `vendor/` vb.).

### Ne kaldı (FAZ 0'ın devamı — SPRINT_PLAN.md)
- **0.2** PHP front controller + Router + PDO + JSON Response + hata yakalama. `GET /api/health` → `{ok:true}`.
- **0.3** `db/schema.sql` + `db/seed.sql` içe aktarma (Hostinger phpMyAdmin).
- **0.4** Auth: register / login / logout / me (Argon2id + httpOnly cookie).
- **0.5** `TenantMiddleware` + `BaseRepository` (tenant scope zorunlu).
- **0.6** Vite + React + TS + Tailwind + PWA iskeleti.
- **0.7** `scripts/deploy.sh` + uçtan uca `/api/health` testi.

### Bilinen sorunlar / notlar
- Henüz **kod yazılmadı** — yalnızca dizin iskeleti ve spesifikasyon var. Boş `leaf` dizinler `.gitkeep` ile korunuyor; ilk gerçek dosya eklenince ilgili `.gitkeep` silinebilir.
- `api/config.example.php` ve `db/migrations/001_init.sql` bilinçli olarak oluşturulmadı — içerikleri FAZ 0.2 / 0.3 oturumunda, şema doğrulanarak yazılacak (anti-halüsinasyon protokolü, CLAUDE.md §3).
- `CLAUDE.md §7` gereği bir sonraki oturum bu dosyayı okuyarak başlamalı.
