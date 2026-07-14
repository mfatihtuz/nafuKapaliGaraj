// SKU şablon motoru (SPRINT_PLAN 1.9).
// SKU daima ASCII/İngilizce (CLAUDE.md §5): 'R-{package}-{value}-{tolerance}' → 'R-0805-10K-1P'

import type { Category, PartAttributes } from '../db/types'
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

/**
 * Ad girilmediğinde okunur, kısa bir ad üretir — tekrarı önler (kart gri satırı SKU·kategori gösterir).
 *   • Birimli öznitelik (Ω, F…) varsa:  "1000 Ω · Direnç"  (değer+birim + kategori)
 *   • Birimli yoksa (kablo gibi):        "NYAF 2x0.75mm"    (öznitelik değerleri, kategori yok)
 */
export function autoName(category: Category, attrs: PartAttributes): string {
  const schema = category.attribute_schema ?? []
  const ordered = [...schema].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const withUnit: string[] = []
  const plain: string[] = []
  for (const def of ordered) {
    const v = attrs[def.key]
    if (v === null || v === undefined || String(v).trim() === '') continue
    if (def.unit) withUnit.push(`${String(v).trim()} ${def.unit}`)
    else if (def.in_sku) plain.push(String(v).trim())
  }
  if (withUnit.length) return `${withUnit.join(' ')} · ${category.name_tr}`
  if (plain.length) return plain.join(' ')
  const all = Object.values(attrs).map((x) => (x == null ? '' : String(x).trim())).filter(Boolean)
  return all.length ? all.join(' ') : category.name_tr
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

/**
 * SKU şablonunu "koda girer" (in_sku) işaretli özniteliklerden türetir.
 *   • Önek daima kategori kodu:              KOD
 *   • İşaretlenen her alan sona eklenir:     KOD-{x}, sonra KOD-{x}-{y}
 *   • İşaret kaldırılırsa alan şablondan çıkar.
 *   • Kaldırılıp tekrar işaretlenen alan EN SONA eklenir (mevcut sıra korunur).
 * Böylece kullanıcı "koda girer" kutucuğunu açıp kapadıkça şablon canlı güncellenir.
 */
export function deriveSkuTemplate(
  code: string,
  schema: { key: string; in_sku?: boolean }[],
  prevTemplate?: string | null,
): string {
  const inSkuKeys = schema.filter((a) => a.in_sku && a.key).map((a) => a.key)
  const inSkuSet = new Set(inSkuKeys)
  // Önceki şablondaki sırayı koru (yalnızca hâlâ işaretli olanlar).
  const kept = skuKeys(prevTemplate).filter((k) => inSkuSet.has(k))
  const seen = new Set(kept)
  // Yeni işaretlenenleri sona ekle.
  const appended = inSkuKeys.filter((k) => !seen.has(k))
  const ordered = [...kept, ...appended]
  const prefix = foldToAscii(code).toUpperCase().replace(/[^A-Z0-9]/g, '')
  return [prefix, ...ordered.map((k) => `{${k}}`)].filter(Boolean).join('-')
}
