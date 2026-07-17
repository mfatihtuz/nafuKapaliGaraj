-- ============================================================
-- Migration 009 — FAZ 3b (ödünç + tedarikçi + sipariş): ref_id indeksi
--
-- Uygulama (Hostinger phpMyAdmin → SQL sekmesi): tamamını yapıştır → Çalıştır.
-- Veya: mysql depo < 009_tx_ref_index.sql
--
-- GÜVENLİ (yalnızca ADD KEY — DROP/CREATE/ALTER COLUMN YOK, veri kaybı YOK):
--   FAZ 3b'nin tüm tabloları (loans, suppliers, part_suppliers, purchase_orders,
--   po_items) 001_init'te ZATEN kuruldu — bu migration YENİ TABLO OLUŞTURMAZ.
--   FAZ 3b hiçbir mevcut tabloya sütun EKLEMEZ. Tek değişiklik: stock_transactions.ref_id
--   üzerinde bir performans indeksi.
--
-- NEDEN: FAZ 3b hareketleri ref_id ile bir varlığa bağlanır (loan_out/loan_return →
--   loan.id, purchase → po_item.id; ayrıca transfer çiftleri). "Bu ödünce/siparişe ait
--   hareketler" sorguları ve gelecekteki mutabakat için ref_id indekssiz taranıyordu.
--
-- NOT: 009 idempotent DEĞİL (indeks ikinci çalıştırmada 'Duplicate key name' verir) —
--   007/008 gibi TEK SEFER uygulanır. Tekrar gerekirse önce `SHOW INDEX FROM
--   stock_transactions` ile idx_tx_ref var mı bak.
-- ============================================================

SET NAMES utf8mb4;

-- FAZ 3b: ref_id ile bağlı hareketler (ödünç/sipariş/transfer çiftleri) için indeks
ALTER TABLE stock_transactions
  ADD KEY idx_tx_ref (tenant_id, ref_id);
