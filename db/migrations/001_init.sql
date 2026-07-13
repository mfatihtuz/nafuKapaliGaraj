-- ============================================================
-- Migration 001 — İlk şema (schema.sql ile birebir aynı)
-- Uygulama: phpMyAdmin > İçe Aktar, veya: mysql < 001_init.sql
-- ============================================================
-- ============================================================
-- DEPO — MySQL 8 / MariaDB 10.6+ Şeması
-- Charset: utf8mb4, Collation: utf8mb4_0900_ai_ci (aksan+harf duyarsız)
-- Tüm ID'ler: CHAR(36) UUIDv7 (istemci üretimli)
-- Tüm zamanlar: UTC, DATETIME(3)
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ------------------------------------------------------------
-- KİRACI (TENANT) & KİMLİK
-- ------------------------------------------------------------

CREATE TABLE tenants (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  plan        VARCHAR(20)  NOT NULL DEFAULT 'free',
  locale      VARCHAR(5)   NOT NULL DEFAULT 'tr',
  settings    JSON         NULL,          -- {qr_base_url, label_size, default_count_mode, ...}
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE users (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  email          VARCHAR(190) NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  display_name   VARCHAR(120) NOT NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tenant_users (
  tenant_id  CHAR(36) NOT NULL,
  user_id    CHAR(36) NOT NULL,
  role       ENUM('owner','member','viewer') NOT NULL DEFAULT 'member',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, user_id),
  KEY idx_tu_user (user_id),
  CONSTRAINT fk_tu_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_tu_user   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sessions (
  token       CHAR(64)    NOT NULL PRIMARY KEY,   -- random_bytes(32) -> hex
  user_id     CHAR(36)    NOT NULL,
  tenant_id   CHAR(36)    NOT NULL,
  expires_at  DATETIME(3) NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_sessions_user (user_id),
  CONSTRAINT fk_sess_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- SENKRONİZASYON ALTYAPISI
-- ------------------------------------------------------------

CREATE TABLE change_log (
  seq        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id  CHAR(36)    NOT NULL,
  entity     VARCHAR(32) NOT NULL,   -- part | location | category | stock_transaction | project | ...
  entity_id  CHAR(36)    NOT NULL,
  op         ENUM('upsert','delete') NOT NULL,
  payload    JSON        NOT NULL,
  actor_id   CHAR(36)    NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_cl_tenant_seq (tenant_id, seq),
  KEY idx_cl_entity (tenant_id, entity, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Idempotency: aynı op_id iki kez uygulanmaz
CREATE TABLE sync_ops (
  op_id      CHAR(36)    NOT NULL PRIMARY KEY,
  tenant_id  CHAR(36)    NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_so_tenant (tenant_id, applied_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- KATEGORİLER & ÖZNİTELİK ŞABLONLARI
-- ------------------------------------------------------------

CREATE TABLE categories (
  id                CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id         CHAR(36)     NOT NULL,
  parent_id         CHAR(36)     NULL,
  name_tr           VARCHAR(120) NOT NULL,
  name_en           VARCHAR(120) NULL,
  code              VARCHAR(16)  NOT NULL,   -- SKU öneki: 'R','C','IC','MOD','MEC'
  -- Öznitelik şablonu. Örnek:
  -- [{"key":"resistance","label_tr":"Direnç","type":"text","unit":"Ω","required":true,"in_sku":true,"order":1},
  --  {"key":"package","label_tr":"Paket","type":"enum","options":["0402","0603","0805","1206","THT"],"in_sku":true,"order":2}]
  attribute_schema  JSON         NULL,
  -- SKU üretim şablonu: 'R-{package}-{resistance}-{tolerance}'
  sku_template      VARCHAR(190) NULL,
  default_count_mode ENUM('exact','level','unmanaged') NOT NULL DEFAULT 'exact',
  sort_order        INT          NOT NULL DEFAULT 0,
  updated_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at        DATETIME(3)  NULL,
  UNIQUE KEY uq_cat_code (tenant_id, code),
  KEY idx_cat_tenant (tenant_id, parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- KONUMLAR
-- ------------------------------------------------------------

CREATE TABLE locations (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36)     NOT NULL,
  parent_id   CHAR(36)     NULL,
  code        VARCHAR(32)  NOT NULL,      -- 'S1-07', 'A2-31', 'W1', 'LOAN-AHMET'
  name        VARCHAR(120) NULL,          -- 'Sembol 105 raf, göz 7'
  type        ENUM('site','cabinet','shelf','drawer','bin','bench','intake','quarantine','loan','project')
              NOT NULL DEFAULT 'drawer',
  path        VARCHAR(255) NOT NULL,      -- materyalize yol: 'GARAJ/S1/S1-07'
  photo_id    CHAR(36)     NULL,          -- attachments.id (çekmece fotoğrafı)
  capacity_note VARCHAR(190) NULL,        -- 'dar hazne, SMD makarası sığmaz'
  sort_order  INT          NOT NULL DEFAULT 0,
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at  DATETIME(3)  NULL,
  UNIQUE KEY uq_loc_code (tenant_id, code),
  KEY idx_loc_parent (tenant_id, parent_id),
  KEY idx_loc_path (tenant_id, path)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- PARÇALAR
-- ------------------------------------------------------------

CREATE TABLE parts (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id     CHAR(36)     NOT NULL,
  category_id   CHAR(36)     NULL,
  sku           VARCHAR(120) NOT NULL,       -- 'R-0805-10K-1P' (ASCII)
  name          VARCHAR(190) NOT NULL,       -- '10 kΩ direnç, 0805, %1'
  mpn           VARCHAR(120) NULL,           -- üretici parça numarası
  manufacturer  VARCHAR(120) NULL,
  attributes    JSON         NULL,           -- {"resistance":"10K","package":"0805","tolerance":"1%"}
  tags          VARCHAR(500) NULL,           -- 'direnç,direnc,resistor,smd,0805' (TR+EN arama)
  count_mode    ENUM('exact','level','unmanaged') NOT NULL DEFAULT 'exact',
  abc_class     ENUM('A','B','C') NOT NULL DEFAULT 'C',
  min_qty       DECIMAL(12,3) NULL,          -- exact mod: bu miktarın altına düşünce uyar
  unit          VARCHAR(16)  NOT NULL DEFAULT 'adet',   -- adet, m, g, paket
  datasheet_url VARCHAR(500) NULL,
  photo_id      CHAR(36)     NULL,
  notes         TEXT         NULL,
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at    DATETIME(3)  NULL,
  UNIQUE KEY uq_parts_sku (tenant_id, sku),
  KEY idx_parts_cat (tenant_id, category_id),
  KEY idx_parts_mpn (tenant_id, mpn),
  FULLTEXT KEY ft_parts (sku, name, mpn, tags)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- STOK — DEFTERDEN TÜRETİLİR, ASLA DOĞRUDAN SENKRONİZE EDİLMEZ
-- ------------------------------------------------------------

CREATE TABLE stock (
  id           CHAR(36)      NOT NULL PRIMARY KEY,
  tenant_id    CHAR(36)      NOT NULL,
  part_id      CHAR(36)      NOT NULL,
  location_id  CHAR(36)      NOT NULL,
  qty          DECIMAL(12,3) NOT NULL DEFAULT 0,     -- count_mode='exact' için
  level        ENUM('full','low','empty') NULL,      -- count_mode='level' için
  level_at     DATETIME(3)   NULL,                   -- level'in son değiştiği an (LWW için)
  last_move_at DATETIME(3)   NULL,
  updated_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_stock (tenant_id, part_id, location_id),
  KEY idx_stock_loc (tenant_id, location_id),
  KEY idx_stock_part (tenant_id, part_id),
  CONSTRAINT fk_stock_part FOREIGN KEY (part_id)     REFERENCES parts(id),
  CONSTRAINT fk_stock_loc  FOREIGN KEY (location_id) REFERENCES locations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- APPEND-ONLY DEFTER. UPDATE ve DELETE YASAK.
CREATE TABLE stock_transactions (
  id           CHAR(36)      NOT NULL PRIMARY KEY,
  tenant_id    CHAR(36)      NOT NULL,
  part_id      CHAR(36)      NOT NULL,
  location_id  CHAR(36)      NOT NULL,
  delta        DECIMAL(12,3) NULL,      -- exact mod: +100 / -3
  level_to     ENUM('full','low','empty') NULL,   -- level mod
  reason       ENUM('purchase','consume','transfer','adjust','audit','scrap','loan_out','loan_return','initial')
               NOT NULL,
  project_id   CHAR(36)      NULL,
  ref_id       CHAR(36)      NULL,      -- transfer çiftini eşleştirir, loan_id, po_id
  note         VARCHAR(255)  NULL,
  actor_id     CHAR(36)      NULL,
  created_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_tx_part (tenant_id, part_id, created_at),
  KEY idx_tx_loc  (tenant_id, location_id, created_at),
  KEY idx_tx_proj (tenant_id, project_id),
  CONSTRAINT fk_tx_part FOREIGN KEY (part_id)     REFERENCES parts(id),
  CONSTRAINT fk_tx_loc  FOREIGN KEY (location_id) REFERENCES locations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- EK DOSYALAR (FAZ 2)
-- ------------------------------------------------------------

CREATE TABLE attachments (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id     CHAR(36)     NOT NULL,
  owner_entity  VARCHAR(32)  NOT NULL,   -- 'part' | 'location' | 'project'
  owner_id      CHAR(36)     NOT NULL,
  kind          ENUM('photo','datasheet','doc') NOT NULL,
  filename      VARCHAR(255) NOT NULL,
  mime          VARCHAR(100) NOT NULL,
  size_bytes    INT UNSIGNED NOT NULL,
  sha256        CHAR(64)     NOT NULL,   -- mükerrer yüklemeyi engeller
  storage_path  VARCHAR(500) NOT NULL,   -- webroot DIŞI
  thumb_path    VARCHAR(500) NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at    DATETIME(3)  NULL,
  KEY idx_att_owner (tenant_id, owner_entity, owner_id),
  UNIQUE KEY uq_att_hash (tenant_id, sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- PROJE / BOM (FAZ 3)
-- ------------------------------------------------------------

CREATE TABLE projects (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36)     NOT NULL,
  name        VARCHAR(190) NOT NULL,
  status      ENUM('planned','active','done','archived') NOT NULL DEFAULT 'planned',
  location_id CHAR(36)     NULL,     -- projeye ait sanal konum (çekilen parçalar burada)
  notes       TEXT         NULL,
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at  DATETIME(3)  NULL,
  KEY idx_proj_tenant (tenant_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE bom_items (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36)      NOT NULL,
  project_id  CHAR(36)      NOT NULL,
  part_id     CHAR(36)      NULL,     -- NULL: henüz eşleşmemiş satır (KiCad'den gelen ham)
  raw_ref     VARCHAR(190)  NULL,     -- 'R1,R2,R5' veya ham MPN
  qty_needed  DECIMAL(12,3) NOT NULL,
  updated_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at  DATETIME(3)   NULL,
  KEY idx_bom_proj (tenant_id, project_id),
  CONSTRAINT fk_bom_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- ÖDÜNÇ (FAZ 3)
-- ------------------------------------------------------------

CREATE TABLE loans (
  id           CHAR(36)      NOT NULL PRIMARY KEY,
  tenant_id    CHAR(36)      NOT NULL,
  part_id      CHAR(36)      NOT NULL,
  qty          DECIMAL(12,3) NOT NULL,
  borrower     VARCHAR(120)  NOT NULL,
  borrower_contact VARCHAR(120) NULL,
  location_id  CHAR(36)      NOT NULL,   -- 'LOAN-AHMET' sanal konumu
  out_at       DATETIME(3)   NOT NULL,
  due_at       DATETIME(3)   NULL,
  returned_at  DATETIME(3)   NULL,
  note         VARCHAR(255)  NULL,
  updated_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at   DATETIME(3)   NULL,
  KEY idx_loan_open (tenant_id, returned_at),
  KEY idx_loan_part (tenant_id, part_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- TEDARİKÇİ / SİPARİŞ (FAZ 3)
-- ------------------------------------------------------------

CREATE TABLE suppliers (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id  CHAR(36)     NOT NULL,
  name       VARCHAR(120) NOT NULL,     -- 'Direnc.net', 'LCSC', 'Robotistan'
  website    VARCHAR(255) NULL,
  updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3)  NULL,
  KEY idx_sup_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE part_suppliers (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  tenant_id     CHAR(36)      NOT NULL,
  part_id       CHAR(36)      NOT NULL,
  supplier_id   CHAR(36)      NOT NULL,
  supplier_sku  VARCHAR(120)  NULL,
  product_url   VARCHAR(500)  NULL,
  last_price    DECIMAL(12,4) NULL,
  currency      CHAR(3)       NOT NULL DEFAULT 'TRY',
  last_price_at DATETIME(3)   NULL,
  updated_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at    DATETIME(3)   NULL,
  UNIQUE KEY uq_ps (tenant_id, part_id, supplier_id),
  KEY idx_ps_part (tenant_id, part_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE purchase_orders (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36)     NOT NULL,
  supplier_id CHAR(36)     NULL,
  status      ENUM('draft','ordered','received','cancelled') NOT NULL DEFAULT 'draft',
  ordered_at  DATETIME(3)  NULL,
  received_at DATETIME(3)  NULL,
  total       DECIMAL(12,2) NULL,
  currency    CHAR(3)      NOT NULL DEFAULT 'TRY',
  note        VARCHAR(255) NULL,
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at  DATETIME(3)  NULL,
  KEY idx_po_tenant (tenant_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE po_items (
  id         CHAR(36)      NOT NULL PRIMARY KEY,
  tenant_id  CHAR(36)      NOT NULL,
  po_id      CHAR(36)      NOT NULL,
  part_id    CHAR(36)      NULL,
  raw_name   VARCHAR(190)  NULL,      -- katalogda olmayan yeni parça
  qty        DECIMAL(12,3) NOT NULL,
  unit_price DECIMAL(12,4) NULL,
  received_qty DECIMAL(12,3) NOT NULL DEFAULT 0,
  target_location_id CHAR(36) NULL,
  updated_at DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3)   NULL,
  KEY idx_poi_po (tenant_id, po_id),
  CONSTRAINT fk_poi_po FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------
-- DÖNGÜSEL SAYIM (FAZ 4)
-- ------------------------------------------------------------

CREATE TABLE audit_sessions (
  id          CHAR(36)    NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36)    NOT NULL,
  scope_location_id CHAR(36) NULL,     -- hangi kabin sayıldı
  started_at  DATETIME(3) NOT NULL,
  finished_at DATETIME(3) NULL,
  items_total INT         NOT NULL DEFAULT 0,
  items_ok    INT         NOT NULL DEFAULT 0,
  accuracy    DECIMAL(5,2) NULL,       -- KPI: doğruluk oranı %
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_audit_tenant (tenant_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
