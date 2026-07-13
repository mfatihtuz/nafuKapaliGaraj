-- ============================================================
-- Migration 002 — login_attempts (kaba-kuvvet koruması)
-- Uygulama: phpMyAdmin > İçe Aktar, veya: mysql < 002_login_attempts.sql
--
-- NOT: Uygulama bu tabloyu ilk auth isteğinde kendi kendine de oluşturur
-- (CREATE TABLE IF NOT EXISTS). Bu dosya kanonik şema bütünlüğü içindir.
-- ============================================================

CREATE TABLE IF NOT EXISTS login_attempts (
  id           CHAR(64)     NOT NULL PRIMARY KEY,   -- sha256(ip|email)
  attempts     INT UNSIGNED NOT NULL DEFAULT 0,
  first_at     DATETIME(3)  NOT NULL,
  locked_until DATETIME(3)  NULL,
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_la_locked (locked_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
