-- ============================================================
-- Migration 008 — Projeler + BOM (FAZ 3a) alan/indeks eklemeleri
--
-- Uygulama (Hostinger phpMyAdmin → SQL sekmesi): tamamını yapıştır → Çalıştır.
-- Veya: mysql depo < 008_projects_bom.sql
--
-- GÜVENLİ (yalnızca ADD — DROP/CREATE YOK, veri kaybı YOK):
--   projects + bom_items tabloları 001_init'te ZATEN kuruldu ama FAZ 3a'ya kadar
--   hiç kullanılmadı (seed yok, kod dokunmuyor). 008 bu tabloları DÜŞÜRMEZ; yalnızca
--   BOM'a KiCad ham alanları + kararlı sıra ekler ve iki performans indeksi açar.
--   Geriye dönük uyumlu; ileride veri olsa da güvenli.
--
-- NOT: 008 idempotent DEĞİL (ADD COLUMN ikinci çalıştırmada hata verir) — 007 gibi
--   TEK SEFER uygulanır. Tekrar çalıştırma gerekirse önce sütun var mı bak.
--
-- TASARIM (design workflow kararı):
--   • Proje birinci sınıf DEĞİL yeni stok tablosu: proje = type='project' bir konum;
--     "projeye çek/iade/tüket" mevcut stok defterini (stock_move, project_id) kullanır.
--   • projects + bom_items = LWW katalog varlıkları (updated_at ile senkronize).
--   • bom_items.part_id NULL = henüz eşleşmemiş ham BOM satırı (KiCad değeri/paketi
--     raw_* alanlarında saklanır; kullanıcı sonradan elle eşler).
-- ============================================================

SET NAMES utf8mb4;

-- 1) bom_items: eşleşmemiş ham satırın çözümü + yeniden-eşleştirme için KiCad alanları
ALTER TABLE bom_items
  ADD COLUMN raw_value     VARCHAR(190) NULL AFTER raw_ref,       -- KiCad 'Value' ('10k')
  ADD COLUMN raw_footprint VARCHAR(120) NULL AFTER raw_value,     -- 'R_0805' (paket ayrımı)
  ADD COLUMN raw_mpn       VARCHAR(120) NULL AFTER raw_footprint, -- ham üretici kodu
  ADD COLUMN note          VARCHAR(255) NULL AFTER raw_mpn,       -- kullanıcı notu
  ADD COLUMN sort_order    INT NOT NULL DEFAULT 0 AFTER note;     -- BOM sırası

-- 2) feasibility ("yapabilir miyim?") + projeye-çekme join'leri için part indeksi
ALTER TABLE bom_items
  ADD KEY idx_bom_part (tenant_id, part_id);

-- 3) proje sanal konumu aramaları (projects.location_id)
ALTER TABLE projects
  ADD KEY idx_proj_loc (tenant_id, location_id);
