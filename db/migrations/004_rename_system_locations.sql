-- ============================================================
-- Migration 004 — Sistem konum KODLARINI yeniden adlandır
--   IN  → GRS   (Giriş Kutusu / intake)
--   W1  → TZGH  (Tezgâh / bench)
--   QT  → KRNT  (Karantina / quarantine)
--
-- Uygulama: phpMyAdmin > İçe Aktar, veya: mysql < 004_rename_system_locations.sql
--
-- NEDEN ASCII: Konum kodları teknik koddur (CLAUDE.md §5) ve QR/URL'de kullanılır;
-- Türkçe karakter giremez. GRŞ yerine GRS, uygulamanın kod temizleyicisi de (ş→s)
-- aynı sonucu verirdi.
--
-- İDEMPOTENT: yalnızca eski kodu taşıyan satırı günceller; ikinci kez çalıştırmak
-- zarar vermez (eşleşme kalmaz). type + eski kod ile eşleştirir (yanlış satıra
-- dokunmaz). Yalnız ilgili satırın path'i değişir (tek segment).
--
-- ÖNEMLİ — istemcilerin görmesi için: bu ham SQL, senkron değişiklik günlüğüne
-- (change_log) kayıt EKLEMEZ; bağlı cihazlar bunu normal pull ile ÇEKMEZ. Her
-- cihazda değişikliği görmek için uygulamada **Çıkış yap → tekrar Giriş yap**
-- (çıkış yerel veriyi temizler, giriş sunucudan sıfırdan yükler). Tek cihazda
-- tek dokunuşluk bir işlemdir.
-- ============================================================

SET NAMES utf8mb4;

UPDATE locations
   SET code = 'GRS',
       path = REPLACE(path, '/IN', '/GRS'),
       updated_at = CURRENT_TIMESTAMP(3)
 WHERE type = 'intake' AND code = 'IN';

UPDATE locations
   SET code = 'TZGH',
       path = REPLACE(path, '/W1', '/TZGH'),
       updated_at = CURRENT_TIMESTAMP(3)
 WHERE type = 'bench' AND code = 'W1';

UPDATE locations
   SET code = 'KRNT',
       path = REPLACE(path, '/QT', '/KRNT'),
       updated_at = CURRENT_TIMESTAMP(3)
 WHERE type = 'quarantine' AND code = 'QT';
