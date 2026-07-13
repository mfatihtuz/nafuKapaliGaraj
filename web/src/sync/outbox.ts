// Outbox — bekleyen yazma işlemleri kuyruğu (SYNC_PROTOCOL §5.4).
// Her yazma önce yerel (optimistik), sonra buraya; arka planda push edilir.
// "Outbox asla sessizce boşaltılmaz."

import { db, metaGet, metaSet } from '../db/dexie'
import type { OutboxOp, OutboxType } from '../db/types'
import { uuidv7 } from '../lib/uuid'
import { api } from './api'
import { revertTx } from './derive'

// Yeniden denemesi anlamsız (kalıcı) red sebepleri — sonsuz döngüyü önler.
const PERMANENT = new Set(['unprocessable', 'not_found', 'forbidden', 'bad_request', 'invalid_op_id'])
// Geçici hata bu sayıya ulaşınca kalıcı sayılır (db_error gibi çözülmeyen kısıt ihlalleri).
const MAX_ATTEMPTS = 8

const SYNC_ERRORS = 'sync_errors'

export interface SyncErrorLog {
  op_id: string
  type: string
  reason: string
  message: string
  at: number
}

/** Bir op'u kuyruğa yaz. op_id verilmezse üretilir. seq otomatik atanır (kararlı sıra). */
export async function enqueue(input: {
  type: OutboxType
  entity?: 'part' | 'location' | 'category'
  data: unknown
  op_id?: string
}): Promise<void> {
  const op: OutboxOp = {
    op_id: input.op_id ?? uuidv7(),
    type: input.type,
    entity: input.entity,
    data: input.data,
    created_at: Date.now(),
    attempts: 0,
  }
  await db.outbox.add(op) // ++seq atanır
}

export async function pendingCount(): Promise<number> {
  return db.outbox.count()
}

export async function getSyncErrors(): Promise<SyncErrorLog[]> {
  return metaGet<SyncErrorLog[]>(SYNC_ERRORS, [])
}

export async function clearSyncErrors(): Promise<void> {
  await metaSet(SYNC_ERRORS, [])
}

async function logErrors(errors: SyncErrorLog[]): Promise<void> {
  if (errors.length === 0) return
  const existing = await getSyncErrors()
  await metaSet(SYNC_ERRORS, [...errors, ...existing].slice(0, 100))
}

/** Kalıcı reddedilen bir op'un yerel optimistik etkisini geri al. */
async function revertLocal(op: OutboxOp): Promise<void> {
  // stock_move (delta veya level) yerelde applyTx ile uygulanmıştı → geri al.
  if (op.type === 'stock_move') {
    const id = (op.data as { id?: string } | null)?.id
    if (id) await revertTx(id)
  }
  // stock_audit: yerel optimistik etki yok. upsert/delete: katalog LWW bir sonraki
  // bootstrap'ta düzelir (nadir kalıcı red).
}

/** Kuyruğu sunucuya push eder. @returns applied / rejected sayıları. */
export async function pushOutbox(): Promise<{ applied: number; rejected: number; sent: number }> {
  const ops = await db.outbox.orderBy('seq').toArray()
  if (ops.length === 0) return { applied: 0, rejected: 0, sent: 0 }

  const payload = ops.map((o) => ({
    op_id: o.op_id,
    type: o.type,
    ...(o.entity ? { entity: o.entity } : {}),
    data: o.data,
  }))

  const result = await api.push(payload) // ağ/401 hatasında throw → engine yakalar

  if (result.applied.length > 0) {
    await db.outbox.where('op_id').anyOf(result.applied).delete()
  }

  const permanentErrors: SyncErrorLog[] = []
  for (const rej of result.rejected) {
    const op = ops.find((o) => o.op_id === rej.op_id)
    if (!op) continue
    const attempts = op.attempts + 1
    const permanent = PERMANENT.has(rej.reason) || attempts >= MAX_ATTEMPTS

    if (permanent) {
      // Görünür şekilde logla, yerel optimistik etkiyi geri al, kuyruktan çıkar.
      permanentErrors.push({
        op_id: op.op_id, type: op.type, reason: rej.reason,
        message: rej.message ?? rej.reason, at: Date.now(),
      })
      await revertLocal(op)
      await db.outbox.where('op_id').equals(op.op_id).delete()
    } else {
      // Geçici hata: dene sayısını artır, kuyrukta tut (bir sonraki turda tekrar).
      await db.outbox.where('op_id').equals(op.op_id).modify({
        attempts,
        last_error: rej.message ?? rej.reason,
      })
    }
  }
  await logErrors(permanentErrors)

  return { applied: result.applied.length, rejected: result.rejected.length, sent: ops.length }
}
