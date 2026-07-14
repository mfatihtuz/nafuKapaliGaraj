// useLiveQuery hook'ları — UI'nin okuma katmanı. IndexedDB değişince otomatik yeniden render.

import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './dexie'
import type { Part, Location, Category, Stock } from './types'
import { searchMatch } from '../lib/normalize'

export interface StockWithPart { stock: Stock; part: Part }
export interface StockWithLocation { stock: Stock; location: Location }
export interface SearchHit { part: Part; places: StockWithLocation[]; categoryName: string | null }

/**
 * "Tükenmiş" satır — konum/parça/arama listelerinden gizlenir (defterde kalır):
 *  • Miktarlı: adet 0'a inmiş (taşınmış/tüketilmiş) ve doluluk bilgisi yok.
 *  • Doluluk: BİTTİ (empty) — o gözde artık yok demektir; taşımada kaynak BİTTİ
 *    olur, gizlenmezse her taşımada geride bir "BİTTİ hayaleti" birikir.
 *  • Takipsiz: varlık işareti negatife inmiş (başka konuma taşınmış).
 * DOLU/AZ satırları görünür kalır. (BİTTİ kalemler ileride "alışveriş listesi"
 * ekranında defterden ayrıca listelenecek — FAZ 2.)
 */
function isExhausted(part: Part, stock: Stock): boolean {
  if (part.count_mode === 'exact') return Number(stock.qty) <= 0 && stock.level == null
  if (part.count_mode === 'level') return stock.level === 'empty'
  if (part.count_mode === 'unmanaged') return Number(stock.qty) < 0
  return false
}

export function useParts(): Part[] {
  return useLiveQuery(
    () => db.parts.filter((p) => !p.deleted_at).sortBy('name'),
    [],
    [],
  )
}

/** undefined = yükleniyor · null = bulunamadı/silinmiş · Part = aktif. */
export function usePart(id: string | undefined): Part | null | undefined {
  return useLiveQuery(async () => {
    if (!id) return null
    const p = await db.parts.get(id)
    return p && !p.deleted_at ? p : null
  }, [id])
}

export function useCategories(): Category[] {
  return useLiveQuery(
    () => db.categories.filter((c) => !c.deleted_at).sortBy('sort_order'),
    [],
    [],
  )
}

export function useCategory(id: string | null | undefined): Category | undefined {
  return useLiveQuery(() => (id ? db.categories.get(id) : undefined), [id])
}

export function useLocations(): Location[] {
  return useLiveQuery(
    () => db.locations.filter((l) => !l.deleted_at).sortBy('sort_order'),
    [],
    [],
  )
}

export function useLocation(id: string | undefined): Location | undefined {
  return useLiveQuery(() => (id ? db.locations.get(id) : undefined), [id])
}

export function useLocationByCode(code: string | undefined): Location | undefined | null {
  return useLiveQuery(async () => {
    if (!code) return null
    const loc = await db.locations.where('code').equalsIgnoreCase(code).first()
    return loc && !loc.deleted_at ? loc : null
  }, [code])
}

/** Bir konumdaki stok satırları + parça bilgisi (Konum ekranı). */
export function useStockAtLocation(locationId: string | undefined): StockWithPart[] {
  return useLiveQuery(
    async () => {
      if (!locationId) return []
      const rows = await db.stock.where('location_id').equals(locationId).toArray()
      const out: StockWithPart[] = []
      for (const stock of rows) {
        const part = await db.parts.get(stock.part_id)
        if (part && !part.deleted_at && !isExhausted(part, stock)) out.push({ stock, part })
      }
      out.sort((a, b) => a.part.name.localeCompare(b.part.name, 'tr'))
      return out
    },
    [locationId],
    [],
  )
}

/** Bir parçanın bulunduğu konumlar + miktar (Parça detay). Tükenmiş (0) satırlar gizli. */
export function useLocationsForPart(partId: string | undefined): StockWithLocation[] {
  return useLiveQuery(
    async () => {
      if (!partId) return []
      const part = await db.parts.get(partId)
      const rows = await db.stock.where('part_id').equals(partId).toArray()
      const out: StockWithLocation[] = []
      for (const stock of rows) {
        if (part && isExhausted(part, stock)) continue
        const location = await db.locations.get(stock.location_id)
        if (location && !location.deleted_at) out.push({ stock, location })
      }
      return out
    },
    [partId],
    [],
  )
}

export function useTransactionsForPart(partId: string | undefined) {
  return useLiveQuery(
    async () => {
      if (!partId) return []
      const rows = await db.transactions.where('part_id').equals(partId).toArray()
      return rows.sort((a, b) => b.created_at.localeCompare(a.created_at))
    },
    [partId],
    [],
  )
}

/**
 * Türkçe-duyarsız arama + kategori/konum filtresi + göz atma.
 * - Sorgu ve filtreler boşsa: TÜM envanter, ada göre sıralı.
 * - Kategori seçiliyse: o kategori ve alt kategorileri.
 * - Konum seçiliyse: o konum ve TÜM alt konumları (dolap → çekmeceleri);
 *   yalnızca oralarda stoğu olan parçalar döner, kartta yalnız o yerler görünür.
 * - Sorgu varsa: metne göre süzme. Hepsi birlikte uygulanır.
 */
export function useSearch(
  query: string,
  categoryId = '',
  includeQuarantine = false,
  locationId = '',
): SearchHit[] {
  return useLiveQuery(
    async () => {
      const q = query.trim()
      const categories = await db.categories.toArray()
      const nameById = new Map(categories.map((c) => [c.id, c.name_tr]))

      // Seçilen kategori + tüm alt kategorileri
      let catSet: Set<string> | null = null
      if (categoryId) {
        catSet = new Set([categoryId])
        let added = true
        while (added) {
          added = false
          for (const c of categories) {
            if (c.parent_id && catSet.has(c.parent_id) && !catSet.has(c.id)) {
              catSet.add(c.id)
              added = true
            }
          }
        }
      }

      // Seçilen konum + tüm alt konumları (dolap seçilince çekmeceleri de kapsar)
      let locSet: Set<string> | null = null
      if (locationId) {
        const locations = await db.locations.toArray()
        locSet = new Set([locationId])
        let added = true
        while (added) {
          added = false
          for (const l of locations) {
            if (l.parent_id && locSet.has(l.parent_id) && !locSet.has(l.id)) {
              locSet.add(l.id)
              added = true
            }
          }
        }
      }

      const parts = await db.parts.filter((p) => !p.deleted_at).toArray()
      const hits: SearchHit[] = []
      for (const part of parts) {
        if (catSet && (!part.category_id || !catSet.has(part.category_id))) continue
        if (q !== '') {
          const attrText = part.attributes ? Object.values(part.attributes).join(' ') : ''
          if (!searchMatch(q, part.sku, part.name, part.mpn, part.tags, attrText)) continue
        }
        const stockRows = await db.stock.where('part_id').equals(part.id).toArray()
        const places: StockWithLocation[] = []
        for (const stock of stockRows) {
          if (isExhausted(part, stock)) continue
          if (locSet && !locSet.has(stock.location_id)) continue
          const location = await db.locations.get(stock.location_id)
          if (!location || location.deleted_at) continue
          if (!includeQuarantine && location.type === 'quarantine') continue
          places.push({ stock, location })
        }
        // Konum filtresi aktifken: o konumda stoğu olmayan parça listelenmez.
        if (locSet && places.length === 0) continue
        hits.push({ part, places, categoryName: part.category_id ? nameById.get(part.category_id) ?? null : null })
      }
      hits.sort((a, b) => a.part.name.localeCompare(b.part.name, 'tr'))
      return hits.slice(0, 300)
    },
    [query, categoryId, includeQuarantine, locationId],
    [],
  )
}

export function useOutboxCount(): number {
  return useLiveQuery(() => db.outbox.count(), [], 0)
}
