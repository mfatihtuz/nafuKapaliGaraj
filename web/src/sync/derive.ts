// Stok, defterden (transactions) türetilir — sunucudaki mantığın aynası (SYNC_PROTOCOL §2).
// applyTx idempotenttir: aynı tx.id iki kez uygulanmaz (yerel sync_ops eşdeğeri).

import { db } from '../db/dexie'
import type { Transaction, Stock } from '../db/types'
import { tsToMs } from '../lib/format'

export function stockKey(partId: string, locationId: string): string {
  return `${partId}|${locationId}`
}

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  return typeof v === 'number' ? v : Number(v)
}

/**
 * Bir hareketi yerel deftere ekler ve stok görünümünü günceller.
 * Zaten uygulanmışsa (tx.id defterde) hiçbir şey yapmaz → çift sayım olmaz.
 */
export async function applyTx(raw: Transaction): Promise<void> {
  await db.transaction('rw', db.transactions, db.stock, async () => {
    const exists = await db.transactions.get(raw.id)
    if (exists) return // idempotent

    const tx: Transaction = {
      ...raw,
      delta: raw.delta === null || raw.delta === undefined ? null : num(raw.delta),
    }
    await db.transactions.put(tx)

    const key = stockKey(tx.part_id, tx.location_id)
    const cur = await db.stock.get(key)
    const base: Stock = cur ?? {
      key, part_id: tx.part_id, location_id: tx.location_id,
      qty: 0, level: null, level_at: null, last_move_at: null,
    }

    // last_move_at: en yeni hareket zamanı
    if (tsToMs(tx.created_at) >= tsToMs(base.last_move_at)) {
      base.last_move_at = tx.created_at
    }

    // exact: qty += delta (delta'lar toplanabilir)
    if (tx.delta !== null) {
      base.qty = num(base.qty) + tx.delta
    }

    // level: durum (LWW by created_at)
    if (tx.level_to) {
      if (base.level_at === null || tsToMs(tx.created_at) > tsToMs(base.level_at)) {
        base.level = tx.level_to
        base.level_at = tx.created_at
      }
    }

    await db.stock.put(base)
  })
}

/**
 * Kalıcı reddedilen optimistik bir hareketi geri alır (SYNC_PROTOCOL §5.4):
 * defter kaydını sil ve delta'yı stoktan düş. Böylece red sonrası yerel stok
 * sunucudan sonsuza dek sapmaz.
 * (Not: level hareketleri tersine çevrilemez — önceki durum kayıp; nadir bu durumda
 *  bir sonraki bootstrap/checksum sunucu doğrusunu geri yükler.)
 */
export async function revertTx(txId: string): Promise<void> {
  await db.transaction('rw', db.transactions, db.stock, async () => {
    const tx = await db.transactions.get(txId)
    if (!tx) return
    await db.transactions.delete(txId)
    if (tx.delta !== null && tx.delta !== undefined) {
      const key = stockKey(tx.part_id, tx.location_id)
      const cur = await db.stock.get(key)
      if (cur) {
        cur.qty = num(cur.qty) - num(tx.delta)
        await db.stock.put(cur)
      }
    }
  })
}

/** Sunucudan gelen ham tx payload'ını yerel Transaction tipine eşler (sayısal alanları düzeltir). */
export function mapTx(p: Record<string, unknown>): Transaction {
  return {
    id: String(p.id),
    part_id: String(p.part_id),
    location_id: String(p.location_id),
    delta: p.delta === null || p.delta === undefined ? null : num(p.delta as number | string),
    level_to: (p.level_to as Transaction['level_to']) ?? null,
    reason: (p.reason as Transaction['reason']) ?? 'adjust',
    project_id: (p.project_id as string | null) ?? null,
    ref_id: (p.ref_id as string | null) ?? null,
    note: (p.note as string | null) ?? null,
    actor_id: (p.actor_id as string | null) ?? null,
    created_at: String(p.created_at),
  }
}

/** Yalnızca defter kaydını saklar; stoğa dokunmaz (bootstrap geçmişi için — snapshot yetkilidir). */
export async function storeTxOnly(tx: Transaction): Promise<void> {
  const exists = await db.transactions.get(tx.id)
  if (!exists) await db.transactions.put(tx)
}

/** Bootstrap stok_snapshot satırını yerel stock tablosuna yazar. */
export async function putSnapshotRow(row: {
  part_id: string; location_id: string; qty: number | string | null;
  level: string | null; level_at: string | null; last_move_at: string | null
}): Promise<void> {
  const key = stockKey(row.part_id, row.location_id)
  await db.stock.put({
    key,
    part_id: row.part_id,
    location_id: row.location_id,
    qty: num(row.qty),
    level: (row.level as Stock['level']) ?? null,
    level_at: row.level_at ?? null,
    last_move_at: row.last_move_at ?? null,
  })
}
