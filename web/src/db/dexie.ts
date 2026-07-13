// IndexedDB (Dexie) — envanterin tam yerel kopyası. UI DAİMA buradan okur (ARCHITECTURE §1).

import Dexie, { type Table } from 'dexie'
import type {
  Part, Location, Category, Stock, Transaction, OutboxOp, MetaRow, AuthState, TenantInfo,
} from './types'

export class DepoDB extends Dexie {
  parts!: Table<Part, string>
  locations!: Table<Location, string>
  categories!: Table<Category, string>
  stock!: Table<Stock, string>
  transactions!: Table<Transaction, string>
  outbox!: Table<OutboxOp, string>
  meta!: Table<MetaRow, string>

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
  ])
}
