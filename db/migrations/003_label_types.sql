-- ============================================================
-- 003 — Etiket tiplerini eksik olan kiracılara ekle (id-bağımsız).
--
-- NEDEN: İlk seed'de etiket tipleri ayrı bir `UPDATE ... WHERE id = @tenant`
-- ile yazılıyordu; kiracı farklı bir id ile oluşturulduysa bu güncelleme
-- boşa düşüyordu. Bu betik, id'den bağımsız olarak label_types'ı EKSİK olan
-- her kiracıya güvenli biçimde ekler (mevcut olanları bozmaz).
--
-- KULLANIM (Hostinger phpMyAdmin → SQL sekmesi):
--   Bu dosyanın tamamını yapıştır → Çalıştır.
-- ============================================================

SET NAMES utf8mb4;

UPDATE tenants
SET settings = JSON_SET(
  COALESCE(settings, JSON_OBJECT()),
  '$.label_types',
  CAST('[{"id":"019f5f4a-b04d-7e2e-bbc6-20c8d171b8ba","name":"S1 · 70’lik göz (küçük)","w_mm":30,"h_mm":12,"cols":6,"rows":22,"qty":70},{"id":"019f5f4a-b04d-7181-8e30-14c13e5fd07d","name":"S2/S3 · modüler çekmece","w_mm":38,"h_mm":21,"cols":5,"rows":13,"qty":42},{"id":"019f5f4a-b04d-72c0-9ac5-5a1b01777457","name":"A1 · büyük çekmece","w_mm":50,"h_mm":30,"cols":4,"rows":9,"qty":16},{"id":"019f5f4a-b04d-77ab-8699-9c5a56c4ade9","name":"A2 · 3D küçük çekmece","w_mm":38,"h_mm":21,"cols":5,"rows":13,"qty":40},{"id":"019f5f4a-b04d-78a3-9797-e2d3d32cbc0c","name":"B1 · dar hazne","w_mm":40,"h_mm":15,"cols":5,"rows":18,"qty":40},{"id":"019f5f4a-b04d-7c57-8a61-8454c73347eb","name":"C1 · kule çekmecesi","w_mm":50,"h_mm":30,"cols":4,"rows":9,"qty":9}]' AS JSON)
)
WHERE JSON_EXTRACT(settings, '$.label_types') IS NULL
   OR JSON_LENGTH(JSON_EXTRACT(settings, '$.label_types')) = 0;
