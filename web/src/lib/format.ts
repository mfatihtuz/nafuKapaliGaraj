// Görüntüleme yardımcıları. UTC → yerel dönüşüm burada yapılır (CLAUDE.md §4).
// Metinler sözlükten gelir (CLAUDE.md §5 — kodda sabit UI metni yok); bu yüzden
// etiket üreten yardımcılar `t` fonksiyonunu parametre alır.

import type { StockLevel, TxReason } from '../db/types'
import type { TFn } from '../i18n'

export function formatQty(qty: number, unit = 'adet'): string {
  const n = Number.isInteger(qty) ? qty.toString() : qty.toFixed(3).replace(/\.?0+$/, '')
  return `${n} ${unit}`
}

/** Doluluk etiketi (DOLU/AZ/BİTTİ) — sözlükten. */
export function levelLabel(t: TFn, level: StockLevel): string {
  return t(`level.${level}`)
}

/** Hareket sebebi etiketi (Satın alma/Tüketim…) — sözlükten. */
export function reasonLabel(t: TFn, reason: TxReason): string {
  return t(`reason.${reason}`)
}

/** Birim etiketi — değer kanoniktir ('metre'); yalnızca GÖRÜNÜM sözlükten çözülür. */
export function unitLabel(t: TFn, unit: string): string {
  return t(`unit.${unit}`)
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

/** "3 dk önce" tarzı göreli zaman — metinler sözlükten. */
export function timeAgo(t: TFn, iso: string | null): string {
  if (!iso) return '—'
  const norm = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'
  const then = new Date(norm).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Math.round((Date.now() - then) / 1000)
  if (diff < 60) return t('time.just_now')
  if (diff < 3600) return t('time.min_ago', { n: Math.floor(diff / 60) })
  if (diff < 86400) return t('time.hour_ago', { n: Math.floor(diff / 3600) })
  if (diff < 2592000) return t('time.day_ago', { n: Math.floor(diff / 86400) })
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
