// useLiveQuery hook'ları — UI'nin okuma katmanı. IndexedDB değişince otomatik yeniden render.

import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './dexie'
import type { Part, Location, Category, Stock, Attachment, PendingUpload, AttachmentOwnerType, Project, BomItem } from './types'
import { searchMatch } from '../lib/normalize'
import { isFreeStock } from '../lib/freeStock'

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

// --- Ekler (FAZ 2.1 — foto/PDF) ---------------------------------------------

export interface OwnerAttachments {
  synced: Attachment[]        // sunucuya yüklenmiş (byte /api/files'ten)
  pending: PendingUpload[]    // henüz yüklenmemiş (blob YEREL — object URL)
}

/** Bir sahibin (parça/konum) tüm eklerini canlı getirir: yüklenmiş + bekleyen. */
export function useOwnerAttachments(
  ownerType: AttachmentOwnerType,
  ownerId: string | undefined,
): OwnerAttachments {
  return useLiveQuery(
    async () => {
      if (!ownerId) return { synced: [], pending: [] }
      const synced = (await db.attachments.where('[owner_type+owner_id]').equals([ownerType, ownerId]).toArray())
        .filter((a) => !a.deleted_at)
        .sort((a, b) => a.sort_order - b.sort_order)
      const pending = (await db.uploads.where('[owner_type+owner_id]').equals([ownerType, ownerId]).toArray())
        .sort((a, b) => a.created_at - b.created_at)
      return { synced, pending }
    },
    [ownerType, ownerId],
    { synced: [], pending: [] },
  )
}

/** Kart thumbnail'ı için birincil foto: ilk yüklenmiş ek id'si veya ilk bekleyen blob. */
export function useFirstPhoto(
  ownerType: AttachmentOwnerType,
  ownerId: string | undefined,
): { attId?: string; pendingBlob?: Blob } | undefined {
  return useLiveQuery(async () => {
    if (!ownerId) return {}
    const synced = (await db.attachments.where('[owner_type+owner_id]').equals([ownerType, ownerId]).toArray())
      .filter((a) => !a.deleted_at && a.kind === 'photo')
      .sort((a, b) => a.sort_order - b.sort_order)
    if (synced[0]) return { attId: synced[0].id }
    const pending = (await db.uploads.where('[owner_type+owner_id]').equals([ownerType, ownerId]).toArray())
      .filter((u) => u.kind === 'photo')
      .sort((a, b) => a.created_at - b.created_at)
    return pending[0] ? { pendingBlob: pending[0].blob } : {}
  }, [ownerType, ownerId])
}

// --- Eksik / alışveriş listesi (FAZ 2.4) ------------------------------------

export interface ShoppingItem {
  part: Part
  have: number
  min: number
  mode: 'exact' | 'level'
  out: boolean          // tamamen tükenmiş
  categoryName: string | null
}

/**
 * Eksik parçalar: (a) miktarlı + min_qty tanımlı + TÜM gözlerdeki toplam < min_qty,
 * (b) doluluk modunda stok kaydı var ama hiçbiri DOLU/AZ değil (hepsi BİTTİ).
 * Takipsiz (unmanaged) atlanır. Eşik TOPLAM üzerinden (göz-bazlı değil) — StockControl'daki
 * göz 'low' rozetiyle karıştırılmamalı. Offline-first: doğrudan Dexie'den.
 */
export function useShoppingList(): ShoppingItem[] {
  return useLiveQuery(
    async () => {
      const parts = await db.parts.filter((p) => !p.deleted_at).toArray()
      const categories = await db.categories.toArray()
      const nameById = new Map(categories.map((c) => [c.id, c.name_tr]))
      // 'Elde' = yalnız SERBEST konumlar (isFreeStock): projeye çekilmiş/ödünç/karantina
      // stok yeniden-sipariş ihtiyacını MASKELEMEZ (feasibility ile aynı kanonik tanım).
      const locs = await db.locations.toArray()
      const locById = new Map(locs.map((l) => [l.id, l]))
      const out: ShoppingItem[] = []
      for (const part of parts) {
        const allRows = await db.stock.where('part_id').equals(part.id).toArray()
        const rows = allRows.filter((r) => isFreeStock(locById.get(r.location_id)))
        const catName = part.category_id ? nameById.get(part.category_id) ?? null : null
        if (part.count_mode === 'exact') {
          if (part.min_qty == null) continue
          const have = rows.reduce((s, r) => s + Math.max(0, Number(r.qty)), 0)
          if (have < part.min_qty) {
            out.push({ part, have, min: part.min_qty, mode: 'exact', out: have <= 0, categoryName: catName })
          }
        } else if (part.count_mode === 'level') {
          if (rows.length === 0) continue
          const stocked = rows.some((r) => r.level === 'full' || r.level === 'low')
          const empty = rows.some((r) => r.level === 'empty')
          if (!stocked && empty) {
            out.push({ part, have: 0, min: 0, mode: 'level', out: true, categoryName: catName })
          }
        }
      }
      out.sort((a, b) =>
        (a.categoryName ?? 'zzz').localeCompare(b.categoryName ?? 'zzz', 'tr') ||
        a.part.name.localeCompare(b.part.name, 'tr'))
      return out
    },
    [],
    [],
  )
}

// --- Projeler + BOM (FAZ 3a) ------------------------------------------------

/** Tüm aktif projeler (status'a göre UI grupluyor). */
export function useProjects(): Project[] {
  return useLiveQuery(
    async () => (await db.projects.filter((p) => !p.deleted_at).toArray())
      .sort((a, b) => a.name.localeCompare(b.name, 'tr')),
    [], [],
  )
}

export function useProject(id: string | undefined): Project | undefined {
  return useLiveQuery(() => (id ? db.projects.get(id) : undefined), [id])
}

/** Bir projenin aktif BOM satırları (sıra). */
export function useBomItems(projectId: string | undefined): BomItem[] {
  return useLiveQuery(
    async () => {
      if (!projectId) return []
      return (await db.bomItems.where('project_id').equals(projectId).toArray())
        .filter((b) => !b.deleted_at)
        .sort((a, b) => a.sort_order - b.sort_order)
    },
    [projectId], [],
  )
}

export interface FeasibilityLine {
  bom: BomItem
  part: Part | null
  need: number
  have: number
  short: number         // exact: eksik adet; level: 0/1
  ok: boolean
  unmatched: boolean    // part_id yok → belirsiz
}
export interface Feasibility {
  lines: FeasibilityLine[]
  shortages: FeasibilityLine[]
  unmatched: FeasibilityLine[]
  canBuild: boolean
}

/**
 * "Bu projeyi yapabilir miyim?" — SAF Dexie türetmesi (sunucu ucu YOK, uçak modunda çalışır).
 * 'Elde' = yalnız SERBEST konumlardaki stok (isFreeStock: proje/ödünç/karantina hariç) →
 * projeye zaten çekilmiş parça ikinci kez "elde" sayılmaz. Eşleşmemiş (part_id yok) satırlar
 * belirsiz sayılır ve yeşil "yapılabilir"i engeller (dürüst).
 */
export function useProjectFeasibility(projectId: string | undefined): Feasibility {
  const empty: Feasibility = { lines: [], shortages: [], unmatched: [], canBuild: false }
  return useLiveQuery(
    async () => {
      if (!projectId) return empty
      const boms = (await db.bomItems.where('project_id').equals(projectId).toArray())
        .filter((b) => !b.deleted_at)
        .sort((a, b) => a.sort_order - b.sort_order)
      if (boms.length === 0) return empty

      const locs = await db.locations.toArray()
      const locById = new Map(locs.map((l) => [l.id, l]))

      const lines: FeasibilityLine[] = []
      for (const bom of boms) {
        if (!bom.part_id) {
          lines.push({ bom, part: null, need: bom.qty_needed, have: 0, short: bom.qty_needed, ok: false, unmatched: true })
          continue
        }
        const part = await db.parts.get(bom.part_id)
        if (!part || part.deleted_at) {
          lines.push({ bom, part: null, need: bom.qty_needed, have: 0, short: bom.qty_needed, ok: false, unmatched: true })
          continue
        }
        const rows = (await db.stock.where('part_id').equals(part.id).toArray())
          .filter((s) => isFreeStock(locById.get(s.location_id)))
        const need = Number(bom.qty_needed)
        if (part.count_mode === 'level') {
          // Doluluk: serbest bir konumda DOLU/AZ varsa "var" say.
          const have = rows.some((s) => s.level === 'full' || s.level === 'low') ? 1 : 0
          const ok = have >= 1
          lines.push({ bom, part, need, have, short: ok ? 0 : 1, ok, unmatched: false })
        } else {
          // Miktarlı / takipsiz: serbest konumlardaki toplam.
          const have = rows.reduce((s, r) => s + Math.max(0, Number(r.qty)), 0)
          const short = Math.max(0, need - have)
          lines.push({ bom, part, need, have, short, ok: short <= 0, unmatched: false })
        }
      }
      const shortages = lines.filter((l) => !l.unmatched && !l.ok)
      const unmatched = lines.filter((l) => l.unmatched)
      return { lines, shortages, unmatched, canBuild: shortages.length === 0 && unmatched.length === 0 }
    },
    [projectId], empty,
  )
}
