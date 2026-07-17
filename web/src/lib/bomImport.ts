// BOM CSV'sini içe-aktarılabilir plana çevirir (FAZ 3a). csv.ts + bomMatch.ts yeniden
// kullanır. SAF katman (Dexie yazımı yok) → test edilebilir. KiCad gruplanmış çıktı öncelikli
// (Value+Footprint başına tek satır, Qty). Qty yoksa referans sayısından hesaplanır.

import type { Part } from '../db/types'
import { normalize } from './normalize'
import { parseCsv } from './csv'
import { matchBomRow, type MatchKind } from './bomMatch'
import type { BomDraft } from '../db/actions'

type Field = 'ref' | 'value' | 'footprint' | 'mpn' | 'qty' | 'note'

const HEADER_ALIASES: Record<string, Field> = {
  ref: 'ref', refs: 'ref', reference: 'ref', references: 'ref', designator: 'ref', designators: 'ref', referans: 'ref',
  value: 'value', deger: 'value', 'değer': 'value', val: 'value',
  footprint: 'footprint', paket: 'footprint', package: 'footprint', 'ayak izi': 'footprint',
  mpn: 'mpn', 'uretici kodu': 'mpn', 'manufacturer part': 'mpn', 'part number': 'mpn',
  qty: 'qty', quantity: 'qty', adet: 'qty', miktar: 'qty', qnty: 'qty',
  note: 'note', not: 'note', notlar: 'note', comment: 'note',
}

export interface BomPlanRow {
  line: number
  draft: BomDraft
  matchKind: MatchKind
  partName: string | null   // eşleşen parça adı (önizleme)
}
export interface BomPlan {
  rows: BomPlanRow[]
  matched: number
  unmatched: number
  unknownHeaders: string[]
}

function countRefs(ref: string): number {
  const parts = ref.split(/[,\s]+/).filter(Boolean)
  return parts.length
}

/** BOM CSV metnini → plan (eşleştirilmiş taslak satırlar). */
export function buildBomPlan(text: string, parts: Part[]): BomPlan {
  const grid = parseCsv(text)
  if (grid.length === 0) return { rows: [], matched: 0, unmatched: 0, unknownHeaders: [] }
  const header = grid[0]
  const fields = header.map((h) => HEADER_ALIASES[normalize(h)] ?? null)
  const unknownHeaders = header.filter((h, i) => h.trim() !== '' && fields[i] === null)
  const idx = (f: Field) => fields.indexOf(f)

  const rows: BomPlanRow[] = []
  let matched = 0, unmatched = 0
  for (let r = 1; r < grid.length; r++) {
    const raw = grid[r]
    const cell = (f: Field): string => { const i = idx(f); return i === -1 ? '' : (raw[i] ?? '').trim() }
    const ref = cell('ref')
    const value = cell('value')
    const footprint = cell('footprint')
    const mpn = cell('mpn')
    const note = cell('note')
    const qtyRaw = cell('qty')
    // qty: sütun varsa onu, yoksa referans sayısını, o da yoksa 1
    let qty = qtyRaw !== '' ? Number(qtyRaw.replace(',', '.')) : (ref !== '' ? countRefs(ref) : 1)
    if (!Number.isFinite(qty) || qty <= 0) qty = 1

    // İçerik yoksa satırı atla (tümü boş)
    if (ref === '' && value === '' && mpn === '') continue

    const m = matchBomRow({ mpn, value, footprint }, parts)
    if (m.part) matched++; else unmatched++

    rows.push({
      line: r,
      matchKind: m.kind,
      partName: m.part?.name ?? null,
      draft: {
        part_id: m.part?.id ?? null,
        raw_ref: ref || null,
        raw_value: value || null,
        raw_footprint: footprint || null,
        raw_mpn: mpn || null,
        note: note || null,
        sort_order: r - 1,
        qty_needed: qty,
      },
    })
  }
  return { rows, matched, unmatched, unknownHeaders }
}

export const BOM_TEMPLATE_HEADERS = ['ref', 'value', 'footprint', 'mpn', 'qty', 'note']
