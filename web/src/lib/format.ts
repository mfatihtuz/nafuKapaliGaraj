// Görüntüleme yardımcıları. UTC → yerel dönüşüm burada yapılır (CLAUDE.md §4).

import type { StockLevel, TxReason } from '../db/types'

export function formatQty(qty: number, unit = 'adet'): string {
  const n = Number.isInteger(qty) ? qty.toString() : qty.toFixed(3).replace(/\.?0+$/, '')
  return `${n} ${unit}`
}

export const LEVEL_LABEL: Record<StockLevel, string> = {
  full: 'DOLU',
  low: 'AZ',
  empty: 'BİTTİ',
}

export const REASON_LABEL: Record<TxReason, string> = {
  purchase: 'Satın alma',
  consume: 'Tüketim',
  transfer: 'Transfer',
  adjust: 'Düzeltme',
  audit: 'Sayım',
  scrap: 'Atık',
  loan_out: 'Ödünç verildi',
  loan_return: 'Ödünç iade',
  initial: 'Açılış',
}

/** UTC ISO/DB string → yerel "13 Tem 2026 12:14" biçimi. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  // DB "Y-m-d H:i:s.v" biçimini ISO'ya çevir (UTC varsay).
  const norm = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'
  const d = new Date(norm)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('tr-TR', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** "3 dk önce" tarzı göreli zaman. */
export function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const norm = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'
  const then = new Date(norm).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Math.round((Date.now() - then) / 1000)
  if (diff < 60) return 'az önce'
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`
  if (diff < 86400) return `${Math.floor(diff / 3600)} sa önce`
  if (diff < 2592000) return `${Math.floor(diff / 86400)} gün önce`
  return formatDateTime(iso)
}

/** ISO8601 (ms, Z) — hareket created_at için. */
export function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Karışık biçimli zaman damgasını (ISO 'T…Z' veya DB 'Y-m-d H:i:s.v') epoch-ms'e çevirir.
 * Sunucudan gelen (DB biçimi) ve yerel (ISO) damgaları güvenle karşılaştırmak için — LWW.
 */
export function tsToMs(ts: string | null | undefined): number {
  if (!ts) return 0
  const norm = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z'
  const t = Date.parse(norm)
  return Number.isNaN(t) ? 0 : t
}
