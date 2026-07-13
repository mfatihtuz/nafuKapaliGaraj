-- ============================================================
-- Mevcut kuruluma yönetici ekle: mfatihtuz / Fraude45.
-- phpMyAdmin > (veritabanını seç) > Import ile bir kez çalıştır.
-- Güvenli: username sütunu yoksa ekler; kullanıcı zaten varsa yok sayar.
-- ============================================================

SET NAMES utf8mb4;

-- 1) users.username sütunu yoksa ekle (MySQL/MariaDB uyumlu koşullu ALTER)
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'username');
SET @sql := IF(@col = 0,
  'ALTER TABLE users ADD COLUMN username VARCHAR(60) NULL AFTER email, ADD UNIQUE KEY uq_users_username (username)',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2) Mevcut organizasyonu (ilk tenant) bul ve mfatihtuz'u owner olarak ekle
SET @tenant := (SELECT tenant_id FROM tenant_users ORDER BY created_at ASC LIMIT 1);
SET @admin  := '019f5d4d-7930-7e5b-9e5d-a82897a56f95';

INSERT IGNORE INTO users (id, email, username, password_hash, display_name) VALUES
  (@admin, 'mfatihtuz@nafuhome.local', 'mfatihtuz',
   '$argon2id$v=19$m=65536,t=4,p=1$ejlLZ1oueEhWbm83RHlIOA$HiKb9BthfCW19h6bX2fJCTFnDNd80vvHec7r3cLScis',
   'M. Fatih');

INSERT IGNORE INTO tenant_users (tenant_id, user_id, role) VALUES
  (@tenant, @admin, 'owner');

-- Doğrulama: SELECT id, username, display_name FROM users WHERE username='mfatihtuz';
