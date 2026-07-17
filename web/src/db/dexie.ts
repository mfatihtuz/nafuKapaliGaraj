// IndexedDB (Dexie) — envanterin tam yerel kopyası. UI DAİMA buradan okur (ARCHITECTURE §1).

import Dexie, { type Table } from 'dexie'
import type {
  Part, Location, Category, Stock, Transaction, OutboxOp, MetaRow, AuthState, TenantInfo,
  Attachment, PendingUpload, Project, BomItem, Supplier, PartSupplier, Loan, PurchaseOrder, PoItem,
} from './types'

export class DepoDB extends Dexie {
  parts!: Table<Part, string>
  locations!: Table<Location, string>
  categories!: Table<Category, string>
  stock!: Table<Stock, string>
  transactions!: Table<Transaction, string>
  outbox!: Table<OutboxOp, string>
  meta!: Table<MetaRow, string>
  attachments!: Table<Attachment, string> // senkronlanan ek METADATA (blob yok)
  uploads!: Table<PendingUpload, string>   // giden yükleme kuyruğu (blob YEREL)
  projects!: Table<Project, string>        // FAZ 3a — proje (LWW katalog)
  bomItems!: Table<BomItem, string>        // FAZ 3a — BOM satırı (LWW katalog)
  suppliers!: Table<Supplier, string>      // FAZ 3b — tedarikçi
  partSuppliers!: Table<PartSupplier, string> // FAZ 3b — parça↔tedarikçi + fiyat
  loans!: Table<Loan, string>              // FAZ 3b — ödünç
  purchaseOrders!: Table<PurchaseOrder, string> // FAZ 3b — sipariş
  poItems!: Table<PoItem, string>          // FAZ 3b — sipariş satırı

  constructor() {
    super('depo')
    this.version(1).stores({
      parts: 'id, sku, category_id, count_mode, updated_at, deleted_at',
      locations: 'id, code, parent_id, type, sort_order, updated_at',
      categories: 'id, code, parent_id, sort_order, updated_at',
      stock: 'key, part_id, location_id',
      transactions: 'id, part_id, location_id, created_at',
      // ++seq: kararlı FIFO sıralama (aynı ms'de eklenen part-upsert + stock_move
      // yeniden sıralanıp sunucuda "parça yok" reddine yol açmasın).
      outbox: '++seq, &op_id, created_at',
      meta: 'key',
    })
    // v2 (FAZ 2.1): foto/PDF ekleri. attachments = senkron metadata; uploads = giden blob kuyruğu.
    this.version(2).stores({
      parts: 'id, sku, category_id, count_mode, updated_at, deleted_at',
      locations: 'id, code, parent_id, type, sort_order, updated_at',
      categories: 'id, code, parent_id, sort_order, updated_at',
      stock: 'key, part_id, location_id',
      transactions: 'id, part_id, location_id, created_at',
      outbox: '++seq, &op_id, created_at',
      meta: 'key',
      attachments: 'id, [owner_type+owner_id], owner_id, sha256, updated_at, deleted_at',
      uploads: 'id, [owner_type+owner_id], owner_id, created_at',
    })
    // v3 (FAZ 3a): projeler + BOM. Yeni tablolar boş başlar, ilk sync'te dolar (v2→v3
    // yükseltme mevcut veriye dokunmaz).
    this.version(3).stores({
      parts: 'id, sku, category_id, count_mode, updated_at, deleted_at',
      locations: 'id, code, parent_id, type, sort_order, updated_at',
      categories: 'id, code, parent_id, sort_order, updated_at',
      stock: 'key, part_id, location_id',
      transactions: 'id, part_id, location_id, created_at',
      outbox: '++seq, &op_id, created_at',
      meta: 'key',
      attachments: 'id, [owner_type+owner_id], owner_id, sha256, updated_at, deleted_at',
      uploads: 'id, [owner_type+owner_id], owner_id, created_at',
      projects: 'id, status, location_id, updated_at, deleted_at',
      bomItems: 'id, project_id, part_id, updated_at, deleted_at',
    })
    // v4 (FAZ 3b): tedarikçi + ödünç + sipariş. Yeni tablolar boş başlar, ilk sync'te dolar.
    this.version(4).stores({
      parts: 'id, sku, category_id, count_mode, updated_at, deleted_at',
      locations: 'id, code, parent_id, type, sort_order, updated_at',
      categories: 'id, code, parent_id, sort_order, updated_at',
      stock: 'key, part_id, location_id',
      transactions: 'id, part_id, location_id, created_at',
      outbox: '++seq, &op_id, created_at',
      meta: 'key',
      attachments: 'id, [owner_type+owner_id], owner_id, sha256, updated_at, deleted_at',
      uploads: 'id, [owner_type+owner_id], owner_id, created_at',
      projects: 'id, status, location_id, updated_at, deleted_at',
      bomItems: 'id, project_id, part_id, updated_at, deleted_at',
      suppliers: 'id, name, updated_at, deleted_at',
      partSuppliers: 'id, part_id, supplier_id, [part_id+supplier_id], updated_at, deleted_at',
      loans: 'id, part_id, location_id, returned_at, updated_at, deleted_at',
      purchaseOrders: 'id, supplier_id, status, updated_at, deleted_at',
      poItems: 'id, po_id, part_id, updated_at, deleted_at',
    })
  }
}

export const db = new DepoDB()

// --- meta KV yardımcıları ---------------------------------------------------

export async function metaGet<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key)
  return row ? (row.value as T) : fallback
}

export async function metaSet(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}

export const SYNC_CURSOR = 'sync_cursor'
export const AUTH_KEY = 'auth'
export const TENANT_KEY = 'tenant'
export const BOOTSTRAPPED = 'bootstrapped'

export async function getCursor(): Promise<number> {
  return metaGet<number>(SYNC_CURSOR, 0)
}
export async function setCursor(seq: number): Promise<void> {
  await metaSet(SYNC_CURSOR, seq)
}

export async function getAuth(): Promise<AuthState | null> {
  return metaGet<AuthState | null>(AUTH_KEY, null)
}
export async function setAuth(auth: AuthState | null): Promise<void> {
  await metaSet(AUTH_KEY, auth)
}

export async function getTenant(): Promise<TenantInfo | null> {
  return metaGet<TenantInfo | null>(TENANT_KEY, null)
}

/** Oturum kapanışında yerel veriyi temizle (tenant değişimi güvenliği). */
export async function wipeLocalData(): Promise<void> {
  await Promise.all([
    db.parts.clear(), db.locations.clear(), db.categories.clear(),
    db.stock.clear(), db.transactions.clear(), db.outbox.clear(), db.meta.clear(),
    db.attachments.clear(), db.uploads.clear(), db.projects.clear(), db.bomItems.clear(),
    db.suppliers.clear(), db.partSuppliers.clear(), db.loans.clear(), db.purchaseOrders.clear(), db.poItems.clear(),
  ])
}
