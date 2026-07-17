// BOM ham satırını envanterdeki bir parçaya eşleştirir (FAZ 3a). SAF katman — test edilebilir.
// Öncelik (kullanıcı kararı): MPN → SKU → değer+footprint. Türkçe/aksan duyarsız.

import type { Part } from '../db/types'
import { normalize } from './normalize'

export interface BomRaw {
  mpn?: string | null
  value?: string | null
  footprint?: string | null
  sku?: string | null
}

export type MatchKind = 'mpn' | 'sku' | 'value_fp' | 'value' | 'none'

export interface MatchResult {
  part: Part | null
  kind: MatchKind
}

/** 'R_0805', 'C_0805_HandSolder', '0603' → paket kodu ('0805'). Bulamazsa ''. */
export function footprintCode(fp: string | null | undefined): string {
  if (!fp) return ''
  const m = normalize(fp).match(/(\d{4})/) ?? normalize(fp).match(/(\d{3})/)
  return m ? m[1] : ''
}

/** Bir ham BOM satırını en iyi parçaya eşleştir. Aktif (silinmemiş) parçalar verilir. */
export function matchBomRow(raw: BomRaw, parts: Part[]): MatchResult {
  // 1) MPN birebir
  const nmpn = normalize(raw.mpn ?? '')
  if (nmpn) {
    const p = parts.find((x) => x.mpn && normalize(x.mpn) === nmpn)
    if (p) return { part: p, kind: 'mpn' }
  }
  // 2) SKU birebir (ham değer bazen doğrudan SKU olabilir)
  const nsku = normalize(raw.sku ?? raw.value ?? '')
  if (nsku) {
    const p = parts.find((x) => x.sku && normalize(x.sku) === nsku)
    if (p) return { part: p, kind: 'sku' }
  }
  // 3) Değer (+ footprint): değer parçanın ad/etiket/sku'sunda TAM TOKEN olarak geçmeli
  //    ('1k' → '11k'e YANLIŞ eşleşmesin); footprint verildiyse çelişen paketi reddet.
  const val = normalize(raw.value ?? '')
  if (val) {
    const fp = footprintCode(raw.footprint)
    const hay = (p: Part) => normalize(`${p.name} ${p.tags ?? ''} ${p.sku}`)
    const byValue = parts.filter((p) => valueMatches(val, hay(p)))
    if (fp) {
      const withFp = byValue.filter((p) => hay(p).includes(fp))
      if (withFp.length === 1) return { part: withFp[0], kind: 'value_fp' }
      if (withFp.length > 1) return { part: null, kind: 'value_fp' } // belirsiz → elle seç
      // Footprint verildi ama tam eşleşme yok: adaylardan biri FARKLI bir paket kodu
      // taşıyorsa (ör. '0603' isteniyor '0805'), yanlış pakete OTOMATİK bağlama — elle seç.
      const conflicting = byValue.some((p) => {
        const pfp = footprintCode(hay(p))
        return pfp !== '' && pfp !== fp
      })
      if (conflicting) return { part: null, kind: 'none' }
      // else: adaylarda paket bilgisi yok → değere göre bağlamaya izin ver (aşağıda)
    }
    if (byValue.length === 1) return { part: byValue[0], kind: 'value' }
  }
  return { part: null, kind: 'none' }
}

/** Değer eşleşmesi: her değer token'ı hedef metinde TAM TOKEN olmalı (alt-dizi değil). */
function valueMatches(value: string, haystack: string): boolean {
  const vt = value.split(/[^a-z0-9]+/i).filter(Boolean)
  if (vt.length === 0) return false
  const ht = new Set(haystack.split(/[^a-z0-9]+/i).filter(Boolean))
  return vt.every((t) => ht.has(t))
}
