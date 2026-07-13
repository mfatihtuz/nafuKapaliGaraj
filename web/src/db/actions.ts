// Yazma aksiyonları. Her yazma: (1) YEREL optimistik güncelle, (2) outbox'a yaz, (3) sync tetikle.
// UI asla doğrudan API'ye yazmaz (ARCHITECTURE §1, SYNC_PROTOCOL §5.4).

import { db } from './dexie'
import type { Part, Location, Category, StockLevel, TxReason, Transaction } from './types'
import { uuidv7 } from '../lib/uuid'
import { nowIso } from '../lib/format'
import { enqueue } from '../sync/outbox'
import { applyTx } from '../sync/derive'
import { engine } from '../sync/engine'

// --- Katalog (LWW) ----------------------------------------------------------

export async function savePart(part: Part): Promise<string> {
  const row: Part = { ...part, updated_at: nowIso() }
  await db.parts.put(row)
  await enqueue({ type: 'upsert', entity: 'part', data: row })
  engine.schedule()
  return row.id
}

export async function saveLocation(loc: Location): Promise<string> {
  const row: Location = { ...loc, updated_at: nowIso() }
  await db.locations.put(row)
  await enqueue({ type: 'upsert', entity: 'location', data: row })
  engine.schedule()
  return row.id
}

export async function saveCategory(cat: Category): Promise<string> {
  const row: Category = { ...cat, updated_at: nowIso() }
  await db.categories.put(row)
  await enqueue({ type: 'upsert', entity: 'category', data: row })
  engine.schedule()
  return row.id
}

export async function softDeletePart(id: string): Promise<void> {
  const ts = nowIso()
  const local = await db.parts.get(id)
  if (local) await db.parts.put({ ...local, deleted_at: ts, updated_at: ts })
  await enqueue({ type: 'delete', entity: 'part', data: { id, updated_at: ts } })
  engine.schedule()
}

export async function softDeleteCategory(id: string): Promise<void> {
  const ts = nowIso()
  const local = await db.categories.get(id)
  if (local) await db.categories.put({ ...local, deleted_at: ts, updated_at: ts })
  await enqueue({ type: 'delete', entity: 'category', data: { id, updated_at: ts } })
  engine.schedule()
}

// --- Stok hareketleri (defter — delta toplanabilir) -------------------------

export interface MoveInput {
  partId: string
  locationId: string
  delta: number
  reason: TxReason
  note?: string | null
  projectId?: string | null
  refId?: string | null
}

/** exact mod: qty += delta. Optimistik, ağ beklemez (< 16 ms hedefi). */
export async function moveStock(input: MoveInput): Promise<void> {
  const tx: Transaction = {
    id: uuidv7(),
    part_id: input.partId,
    location_id: input.locationId,
    delta: input.delta,
    level_to: null,
    reason: input.reason,
    project_id: input.projectId ?? null,
    ref_id: input.refId ?? null,
    note: input.note ?? null,
    actor_id: null,
    created_at: nowIso(),
  }
  await applyTx(tx) // yerel stok + defter (idempotent)
  await enqueue({ type: 'stock_move', data: tx })
  engine.schedule()
}

/** level mod: DOLU/AZ/BİTTİ durumu. */
export async function setLevel(
  partId: string,
  locationId: string,
  level: StockLevel,
  note?: string | null,
): Promise<void> {
  const tx: Transaction = {
    id: uuidv7(),
    part_id: partId,
    location_id: locationId,
    delta: null,
    level_to: level,
    reason: 'adjust',
    project_id: null,
    ref_id: null,
    note: note ?? null,
    actor_id: null,
    created_at: nowIso(),
  }
  await applyTx(tx)
  await enqueue({ type: 'stock_move', data: tx })
  engine.schedule()
}

/**
 * Sayım (audit): fiziksel sayım mutlak değeri.
 * Delta'yı SUNUCU kendi güncel qty'sine göre hesaplar (drift'e karşı doğru — SYNC_PROTOCOL §5.3).
 * Bu yüzden yerel optimistik ledger kaydı OLUŞTURULMAZ; sonuç sync turunda yansır.
 */
export async function auditStock(
  partId: string,
  locationId: string,
  countedQty: number,
  note?: string | null,
): Promise<void> {
  await enqueue({
    type: 'stock_audit',
    data: {
      id: uuidv7(),
      part_id: partId,
      location_id: locationId,
      counted_qty: countedQty,
      note: note ?? null,
      created_at: nowIso(),
    },
  })
  engine.schedule()
}
