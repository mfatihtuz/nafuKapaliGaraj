// Sunucudan gelen değişiklikleri (pull + bootstrap) IndexedDB'ye uygular.
// Katalog: LWW (updated_at). Defter: applyTx (idempotent, stok türetilir).

import { db, setCursor, metaSet, TENANT_KEY, BOOTSTRAPPED } from '../db/dexie'
import type { Part, Location, Category, AbcClass, CountMode, LocationType, AttributeDef } from '../db/types'
import { tsToMs } from '../lib/format'
import type { BootstrapResult, PullResult } from './api'
import { applyTx, mapTx, storeTxOnly, putSnapshotRow } from './derive'

// --- eşleyiciler (PDO string alanlarını düzeltir) ---------------------------

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  return Number(v)
}

function mapPart(p: Record<string, unknown>): Part {
  return {
    id: String(p.id),
    category_id: (p.category_id as string | null) ?? null,
    sku: String(p.sku ?? ''),
    name: String(p.name ?? ''),
    mpn: (p.mpn as string | null) ?? null,
    manufacturer: (p.manufacturer as string | null) ?? null,
    attributes: (p.attributes as Part['attributes']) ?? null,
    tags: (p.tags as string | null) ?? null,
    count_mode: (p.count_mode as CountMode) ?? 'exact',
    abc_class: (p.abc_class as AbcClass) ?? 'C',
    min_qty: n(p.min_qty),
    unit: String(p.unit ?? 'adet'),
    datasheet_url: (p.datasheet_url as string | null) ?? null,
    photo_id: (p.photo_id as string | null) ?? null,
    notes: (p.notes as string | null) ?? null,
    updated_at: String(p.updated_at ?? ''),
    deleted_at: (p.deleted_at as string | null) ?? null,
  }
}

function mapLocation(p: Record<string, unknown>): Location {
  return {
    id: String(p.id),
    parent_id: (p.parent_id as string | null) ?? null,
    code: String(p.code ?? ''),
    name: (p.name as string | null) ?? null,
    type: (p.type as LocationType) ?? 'drawer',
    path: String(p.path ?? ''),
    photo_id: (p.photo_id as string | null) ?? null,
    capacity_note: (p.capacity_note as string | null) ?? null,
    sort_order: n(p.sort_order) ?? 0,
    updated_at: String(p.updated_at ?? ''),
    deleted_at: (p.deleted_at as string | null) ?? null,
  }
}

function mapCategory(p: Record<string, unknown>): Category {
  return {
    id: String(p.id),
    parent_id: (p.parent_id as string | null) ?? null,
    name_tr: String(p.name_tr ?? ''),
    name_en: (p.name_en as string | null) ?? null,
    code: String(p.code ?? ''),
    attribute_schema: (p.attribute_schema as AttributeDef[] | null) ?? null,
    sku_template: (p.sku_template as string | null) ?? null,
    default_count_mode: (p.default_count_mode as CountMode) ?? 'exact',
    sort_order: n(p.sort_order) ?? 0,
    updated_at: String(p.updated_at ?? ''),
    deleted_at: (p.deleted_at as string | null) ?? null,
  }
}

// --- LWW upsert (yerel) -----------------------------------------------------

async function lwwPut<T extends { id: string; updated_at: string }>(
  table: import('dexie').Table<T, string>,
  incoming: T,
): Promise<void> {
  const local = await table.get(incoming.id)
  if (!local || tsToMs(incoming.updated_at) >= tsToMs(local.updated_at)) {
    await table.put(incoming)
  }
}

// --- pull değişikliklerini uygula -------------------------------------------

export async function applyChanges(result: PullResult): Promise<void> {
  for (const ch of result.changes) {
    switch (ch.entity) {
      case 'part':
        await lwwPut(db.parts, mapPart(ch.payload))
        break
      case 'location':
        await lwwPut(db.locations, mapLocation(ch.payload))
        break
      case 'category':
        await lwwPut(db.categories, mapCategory(ch.payload))
        break
      case 'stock_transaction':
        await applyTx(mapTx(ch.payload))
        break
      default:
        // bilinmeyen varlık (ileri faz) — yoksay
        break
    }
  }
  await setCursor(result.cursor)
}

// --- bootstrap (ilk kurulum) ------------------------------------------------

export async function applyBootstrap(result: BootstrapResult): Promise<void> {
  await db.transaction('rw', [db.parts, db.locations, db.categories, db.stock, db.transactions], async () => {
    await db.categories.bulkPut(result.categories.map(mapCategory))
    await db.locations.bulkPut(result.locations.map(mapLocation))
    await db.parts.bulkPut(result.parts.map(mapPart))

    // Snapshot yetkilidir → stok buradan; geçmiş tx yalnızca kayıt olarak saklanır.
    for (const s of result.stock_snapshot) {
      await putSnapshotRow(s as never)
    }
    for (const t of result.stock_transactions) {
      await storeTxOnly(mapTx(t))
    }
  })

  await metaSet(TENANT_KEY, result.tenant)
  await setCursor(result.cursor)
  await metaSet(BOOTSTRAPPED, true)
}

/**
 * Self-heal (SYNC_PROTOCOL §5.6): türetilmiş + katalog verisini temizler ve
 * sunucudan sıfırdan bootstrap eder. Yalnızca outbox BOŞKEN çağrılmalı — aksi
 * hâlde bekleyen optimistik yazımlar ezilir. Meta/auth/outbox'a dokunulmaz.
 * bulkPut yerine önce clear: sunucuda artık olmayan (hayalet) satırlar da silinir.
 */
export async function resyncFromServer(): Promise<void> {
  await db.transaction('rw', [db.parts, db.locations, db.categories, db.stock, db.transactions], async () => {
    await Promise.all([
      db.parts.clear(), db.locations.clear(), db.categories.clear(),
      db.stock.clear(), db.transactions.clear(),
    ])
  })
  await metaSet(BOOTSTRAPPED, false)
  await setCursor(0)
}
