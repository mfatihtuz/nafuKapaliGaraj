// CSV satırlarını içe-aktarılabilir parça planına çevirir: başlık eşleme, kategori/konum
// çözümleme, doğrulama, SKU üretimi. SAF katman (Dexie yazımı yok) → kolay test edilir.

import type { Category, CountMode, Location, StockLevel } from '../db/types'
import { normalize, foldToAscii } from './normalize'
import { parseCsv } from './csv'

/** Kanonik alanlar. CSV başlıkları bunlara eşlenir (TR/EN eşanlamlılar). */
export type Field =
  | 'name' | 'sku' | 'category' | 'count_mode' | 'unit' | 'min_qty'
  | 'qty' | 'level' | 'location' | 'manufacturer' | 'mpn' | 'notes' | 'tags' | 'datasheet_url'

/** Başlık (normalize edilmiş) → alan eşlemesi. */
const HEADER_ALIASES: Record<string, Field> = {
  ad: 'name', isim: 'name', name: 'name', parca: 'name', 'parca adi': 'name', urun: 'name',
  sku: 'sku', kod: 'sku', 'parca kodu': 'sku', 'stok kodu': 'sku',
  kategori: 'category', category: 'category', grup: 'category', 'kategori kodu': 'category',
  'sayim': 'count_mode', 'sayim yontemi': 'count_mode', mod: 'count_mode', count_mode: 'count_mode', tip: 'count_mode',
  birim: 'unit', unit: 'unit',
  min: 'min_qty', 'min stok': 'min_qty', min_qty: 'min_qty', 'kritik stok': 'min_qty', 'minimum': 'min_qty',
  adet: 'qty', miktar: 'qty', qty: 'qty', stok: 'qty', 'baslangic stok': 'qty',
  doluluk: 'level', level: 'level', durum: 'level',
  konum: 'location', location: 'location', yer: 'location', 'konum kodu': 'location', cekmece: 'location',
  uretici: 'manufacturer', manufacturer: 'manufacturer', marka: 'manufacturer',
  mpn: 'mpn', 'uretici kodu': 'mpn',
  not: 'notes', notlar: 'notes', notes: 'notes', aciklama: 'notes',
  etiket: 'tags', etiketler: 'tags', tags: 'tags',
  datasheet: 'datasheet_url', 'datasheet url': 'datasheet_url', 'veri sayfasi': 'datasheet_url', link: 'datasheet_url',
}

const COUNT_MODE_ALIASES: Record<string, CountMode> = {
  miktarli: 'exact', exact: 'exact', adet: 'exact', sayili: 'exact',
  doluluk: 'level', level: 'level',
  takipsiz: 'unmanaged', unmanaged: 'unmanaged', takipsi: 'unmanaged',
}

const LEVEL_ALIASES: Record<string, StockLevel> = {
  dolu: 'full', full: 'full',
  az: 'low', low: 'low',
  bitti: 'empty', bos: 'empty', empty: 'empty', tukendi: 'empty',
}

/** Geçerli birimler (i18n unit anahtarlarıyla aynı). */
export const UNITS = ['adet', 'metre', 'cm', 'mm', 'm²', 'gram', 'kg', 'litre', 'ml', 'paket', 'rulo', 'çift', 'takım', 'top']

export interface ResolvedRow {
  name: string
  sku: string
  skuGenerated: boolean
  categoryId: string | null
  categoryLabel: string
  count_mode: CountMode
  unit: string
  min_qty: number | null
  qty: number | null
  level: StockLevel | null
  locationId: string | null
  locationCode: string
  manufacturer: string | null
  mpn: string | null
  notes: string | null
  tags: string | null
  datasheet_url: string | null
}

export interface PlanRow {
  line: number            // CSV'deki satır no (1 = ilk veri satırı)
  raw: string[]
  resolved: ResolvedRow | null
  issues: string[]        // boşsa geçerli
}

export interface ImportPlan {
  headerFields: (Field | null)[]
  unknownHeaders: string[]
  rows: PlanRow[]
  okCount: number
  errorCount: number
}

export interface PlanContext {
  categories: Category[]
  locations: Location[]
  existingSkus: Set<string>   // mevcut parçaların SKU'ları (normalize/upper)
}

/** Türkçe/İngilizce ondalık + binlik ayracı toleranslı sayı ayrıştırma. */
export function parseNum(raw: string): number | null {
  let s = raw.trim().replace(/\s/g, '')
  if (s === '') return null
  if (s.includes('.') && s.includes(',')) {
    // '1.234,5' → '.' binlik, ',' ondalık
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (s.includes(',')) {
    s = s.replace(',', '.') // yalnız ',' → ondalık
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function skuFromName(name: string): string {
  const t = foldToAscii(name).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return (t || 'PARCA').slice(0, 20)
}

/** Benzersiz SKU üret: taban çakışırsa -2, -3… ekle. `used` içine kaydeder. */
function uniqueSku(base: string, used: Set<string>): string {
  let s = base, i = 1
  while (used.has(s.toUpperCase())) { i++; s = `${base}-${i}` }
  used.add(s.toUpperCase())
  return s
}

/** CSV metnini → içe-aktarma planına çevir (doğrulama + çözümleme). */
export function buildImportPlan(text: string, ctx: PlanContext): ImportPlan {
  const grid = parseCsv(text)
  if (grid.length === 0) {
    return { headerFields: [], unknownHeaders: [], rows: [], okCount: 0, errorCount: 0 }
  }
  // Başlık eşleme
  const header = grid[0]
  const headerFields = header.map((h) => HEADER_ALIASES[normalize(h)] ?? null)
  const unknownHeaders = header.filter((h, i) => h.trim() !== '' && headerFields[i] === null)

  // Kategori arama tabloları
  const catByCode = new Map<string, Category>()
  const catByName = new Map<string, Category>()
  for (const c of ctx.categories) {
    if (c.code) catByCode.set(normalize(c.code), c)
    catByName.set(normalize(c.name_tr), c)
    if (c.name_en) catByName.set(normalize(c.name_en), c)
  }
  const locByCode = new Map<string, Location>()
  for (const l of ctx.locations) locByCode.set(normalize(l.code), l)

  const used = new Set<string>([...ctx.existingSkus].map((s) => s.toUpperCase()))
  const rows: PlanRow[] = []
  let okCount = 0, errorCount = 0

  for (let r = 1; r < grid.length; r++) {
    const raw = grid[r]
    const get = (f: Field): string => {
      const idx = headerFields.indexOf(f)
      return idx === -1 ? '' : (raw[idx] ?? '').trim()
    }
    const issues: string[] = []

    const name = get('name')
    if (name === '') issues.push('Ad boş')

    // Kategori
    const catRaw = get('category')
    let category: Category | null = null
    if (catRaw !== '') {
      category = catByCode.get(normalize(catRaw)) ?? catByName.get(normalize(catRaw)) ?? null
      if (!category) issues.push(`Kategori bulunamadı: "${catRaw}"`)
    }

    // Sayım yöntemi
    const modeRaw = get('count_mode')
    let count_mode: CountMode
    if (modeRaw !== '') {
      const m = COUNT_MODE_ALIASES[normalize(modeRaw)]
      if (!m) { issues.push(`Geçersiz sayım yöntemi: "${modeRaw}"`); count_mode = 'exact' }
      else count_mode = m
    } else {
      count_mode = category?.default_count_mode ?? 'exact'
    }

    // Birim (yalnız exact'te anlamlı; diğerlerinde 'adet')
    const unitRaw = get('unit')
    let unit = 'adet'
    if (count_mode === 'exact' && unitRaw !== '') {
      if (!UNITS.includes(unitRaw)) issues.push(`Geçersiz birim: "${unitRaw}"`)
      else unit = unitRaw
    }

    // min stok
    const minRaw = get('min_qty')
    let min_qty: number | null = null
    if (minRaw !== '') {
      const m = parseNum(minRaw)
      if (m === null || m < 0) issues.push(`Geçersiz min stok: "${minRaw}"`)
      else min_qty = m
    }

    // Başlangıç miktarı / doluluk + konum
    const qtyRaw = get('qty')
    const levelRaw = get('level')
    const locRaw = get('location')
    let qty: number | null = null
    let level: StockLevel | null = null
    let location: Location | null = null

    if (count_mode === 'level' && levelRaw !== '') {
      level = LEVEL_ALIASES[normalize(levelRaw)] ?? null
      if (!level) issues.push(`Geçersiz doluluk: "${levelRaw}"`)
    }
    if (count_mode === 'exact' && qtyRaw !== '') {
      qty = parseNum(qtyRaw)
      if (qty === null || qty < 0) issues.push(`Geçersiz miktar: "${qtyRaw}"`)
    }
    // Başlangıç stoğu istendiyse konum zorunlu
    const wantsStock = (count_mode === 'exact' && qty !== null && qty > 0)
      || (count_mode === 'level' && level !== null)
      || (count_mode === 'unmanaged' && locRaw !== '')
    if (wantsStock || locRaw !== '') {
      if (locRaw === '') issues.push('Miktar/doluluk verildi ama konum boş')
      else {
        location = locByCode.get(normalize(locRaw)) ?? null
        if (!location) issues.push(`Konum bulunamadı: "${locRaw}"`)
      }
    }

    // SKU: verilmişse kullan (ASCII/upper), çakışırsa hata; boşsa üret
    const skuRaw = get('sku')
    let sku: string, skuGenerated = false
    if (skuRaw !== '') {
      sku = foldToAscii(skuRaw).toUpperCase().replace(/[^A-Z0-9.\-_/]+/g, '')
      if (sku === '') { issues.push('SKU geçersiz'); sku = '' }
      else if (used.has(sku.toUpperCase())) issues.push(`SKU zaten var: "${sku}"`)
      else used.add(sku.toUpperCase())
    } else {
      sku = name !== '' ? uniqueSku(skuFromName(name), used) : ''
      skuGenerated = true
    }

    const resolved: ResolvedRow | null = issues.length === 0 ? {
      name, sku, skuGenerated,
      categoryId: category?.id ?? null,
      categoryLabel: category?.name_tr ?? '—',
      count_mode, unit, min_qty, qty, level,
      locationId: location?.id ?? null,
      locationCode: location?.code ?? '',
      manufacturer: get('manufacturer') || null,
      mpn: get('mpn') || null,
      notes: get('notes') || null,
      tags: get('tags') || null,
      datasheet_url: get('datasheet_url') || null,
    } : null

    if (issues.length === 0) okCount++; else errorCount++
    rows.push({ line: r, raw, resolved, issues })
  }

  return { headerFields, unknownHeaders, rows, okCount, errorCount }
}

/** Örnek şablon başlıkları (indirilecek CSV). */
export const TEMPLATE_HEADERS = [
  'ad', 'kategori', 'sku', 'sayim', 'birim', 'min', 'adet', 'doluluk', 'konum', 'uretici', 'mpn', 'not',
]
