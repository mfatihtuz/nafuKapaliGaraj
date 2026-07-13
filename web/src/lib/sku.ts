// SKU şablon motoru (SPRINT_PLAN 1.9).
// SKU daima ASCII/İngilizce (CLAUDE.md §5): 'R-{package}-{value}-{tolerance}' → 'R-0805-10K-1P'

import type { PartAttributes } from '../db/types'
import { foldToAscii } from './normalize'

function skuToken(raw: string): string {
  return foldToAscii(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9.]+/g, '') // yalnızca ASCII harf/rakam/nokta
}

/**
 * Şablondaki {key} yer tutucularını öznitelik değerleriyle doldurur.
 * Boş değerler token'ı düşürür; artık ayraçlar temizlenir.
 */
export function buildSku(template: string | null | undefined, attrs: PartAttributes): string {
  if (!template) return ''
  const out = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = attrs[key]
    return v === null || v === undefined || v === '' ? '' : skuToken(String(v))
  })
  return out.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '')
}

/** Şablondaki tüm {key} anahtarlarını döndürür (SKU'yu etkileyen alanlar). */
export function skuKeys(template: string | null | undefined): string[] {
  if (!template) return []
  const keys: string[] = []
  const re = /\{(\w+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(template)) !== null) keys.push(m[1])
  return keys
}
