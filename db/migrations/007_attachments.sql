-- ============================================================
-- Migration 007 — attachments (parça & konum foto/PDF ekleri) — FİNAL TASARIM
--
-- Uygulama (Hostinger phpMyAdmin → SQL sekmesi): tamamını yapıştır → Çalıştır.
-- Veya: mysql depo < 007_attachments.sql
--
-- NEDEN DROP + CREATE (güvenli):
--   attachments 001_init'te taslak olarak oluşturuldu ama Faz 2 henüz
--   YAZILMADI: seed.sql'de tek satır ek yok, parts.photo_id / locations.photo_id
--   hiçbir yerde doldurulmadı, hiçbir kod tabloya dokunmuyor. Bu yüzden tabloyu
--   düşürüp nihai şemayla yeniden kurmak veri KAYBETMEZ. (Prod'da veri olsaydı
--   bunun yerine ALTER TABLE ile ilerlerdik.)
--
-- TASARIM KARARLARI (001'deki taslaktan farklar):
--   1) owner_entity(VARCHAR) → owner_type ENUM('part','location')
--      Polimorfik sahiplik. FK YOK (tek sütun iki tabloya işaret edemez);
--      bütünlük uygulama katmanında + change_log ile korunur (change_log da
--      aynı polimorfik `entity` yaklaşımını kullanıyor).
--   2) kind ENUM('photo','datasheet','doc') → ENUM('photo','pdf')
--      Görev kapsamı: foto + PDF. URL datasheet zaten parts.datasheet_url'de;
--      YÜKLENEN datasheet PDF'i kind='pdf' olur.
--   3) width / height eklendi (INT UNSIGNED, foto için piksel; pdf'te NULL).
--   4) sort_order eklendi — bir sahibin birden çok fotoğrafını sıralamak için.
--   5) updated_at EKLENDİ. attachments bir KATALOG varlığıdır → senkronizasyonda
--      LWW (SYNC_PROTOCOL §2A). LWW updated_at olmadan çözülemez; taslakta
--      eksikti, bu bir senkron hatası olurdu. Artık var.
--   6) UNIQUE(tenant_id, sha256) → NON-UNIQUE KEY.
--      Dedup DEPOLAMA katmanında yapılır (aynı sha256 = diskte tek bayt kopyası,
--      storage_path deterministik). Ama AYNI fiziksel görsel birden çok sahibe
--      eklenebilmeli (ör. bir çekmece fotoğrafı hem location hem içindeki part
--      için). Hard UNIQUE bunu yasaklardı; bu yüzden yalnızca dedup lookup'ı
--      hızlandıran indeks tutuyoruz.
--
-- DEPOLAMA: storage_path webroot DIŞI (CLAUDE.md §6). Deterministik öneri:
--   storage/{tenant_id}/{sha256[0:2]}/{sha256}{ext}. Dosyaya erişim yalnızca
--   yetkilendirilmiş PHP endpoint'i üzerinden (tenant_id kontrolüyle).
--
-- SENKRONİZASYON: Metadata satırı change_log'a entity='attachment', op=upsert|
--   delete ile akar (LWW). İkili DOSYA change_log payload'ında GİTMEZ; ayrı
--   POST /api/attachments (multipart) ile yüklenir, GET /api/attachments/{id}
--   ile indirilir. İstemci pull'da yeni ek metadata'sını görür, dosyayı gerektiğinde
--   (lazy) çeker. sha256 istemcide de tutulur → tekrar indirmeyi önler.
-- ============================================================

SET NAMES utf8mb4;

DROP TABLE IF EXISTS attachments;

CREATE TABLE attachments (
  id           CHAR(36)     NOT NULL PRIMARY KEY,       -- UUIDv7 (istemci üretimli)
  tenant_id    CHAR(36)     NOT NULL,
  owner_type   ENUM('part','location') NOT NULL,        -- polimorfik sahip türü
  owner_id     CHAR(36)     NOT NULL,                    -- parts.id | locations.id
  kind         ENUM('photo','pdf') NOT NULL,
  filename     VARCHAR(255) NOT NULL,                    -- kullanıcının orijinal dosya adı
  mime         VARCHAR(100) NOT NULL,                    -- 'image/jpeg','image/webp','application/pdf'
  size_bytes   INT UNSIGNED NOT NULL,                    -- görevdeki "size"
  sha256       CHAR(64)     NOT NULL,                    -- içerik özeti; dedup + değişmezlik
  width        INT UNSIGNED NULL,                        -- foto piksel genişliği (pdf: NULL)
  height       INT UNSIGNED NULL,                        -- foto piksel yüksekliği (pdf: NULL)
  storage_path VARCHAR(500) NOT NULL,                    -- webroot DIŞI, sha256'dan türetilir
  thumb_path   VARCHAR(500) NULL,                        -- küçük önizleme (foto), pdf: NULL
  sort_order   INT          NOT NULL DEFAULT 0,          -- aynı sahipte sıralama
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),  -- LWW anahtarı
  deleted_at   DATETIME(3)  NULL,                        -- soft delete (hard delete senkronlanamaz)
  -- Bir sahibin eklerini sıralı listelemek: WHERE tenant_id=? AND owner_type=? AND owner_id=? ORDER BY sort_order
  KEY idx_att_owner (tenant_id, owner_type, owner_id, sort_order),
  -- Tenant-içi dedup lookup'ı: sha256 zaten var mı? (UNIQUE DEĞİL — bkz. başlık notu)
  KEY idx_att_sha (tenant_id, sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
