// Yazma aksiyonları. Her yazma: (1) YEREL optimistik güncelle, (2) outbox'a yaz, (3) sync tetikle.
// UI asla doğrudan API'ye yazmaz (ARCHITECTURE §1, SYNC_PROTOCOL §5.4).

import { db } from './dexie'
import type {
  Part, Location, Category, Stock, StockLevel, TxReason, Transaction, OutboxOp,
  AttachmentOwnerType, AttachmentKind, PendingUpload,
} from './types'
import { uuidv7 } from '../lib/uuid'
import { nowIso } from '../lib/format'
import { enqueue } from '../sync/outbox'
import { applyTx } from '../sync/derive'
import { engine } from '../sync/engine'
import { downscaleImage, sha256Hex } from '../lib/image'

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

/**
 * Toplu konum yazımı — konum satırları + outbox op'ları TEK Dexie transaction'ında
 * (atomik: hepsi ya da hiçbiri; bir hata yarım ağaç bırakmaz). Toplu çekmece
 * üreticisi yüzlerce satırı tek tek yazmak yerine buradan geçirir (tek işlem, tek
 * sync tetiği — çok daha hızlı). op_id'ler burada üretilir; seq'i Dexie atar.
 */
export async function saveLocationsBulk(rows: Location[]): Promise<void> {
  if (rows.length === 0) return
  const ts = nowIso()
  const stamped: Location[] = rows.map((r) => ({ ...r, updated_at: ts }))
  const ops: OutboxOp[] = stamped.map((row) => ({
    op_id: uuidv7(),
    type: 'upsert',
    entity: 'location',
    data: row,
    created_at: Date.now(),
    attempts: 0,
  }))
  await db.transaction('rw', db.locations, db.outbox, async () => {
    await db.locations.bulkPut(stamped)
    await db.outbox.bulkAdd(ops) // seq (++auto) sıra korunur: ebeveyn önce
  })
  engine.schedule()
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

export async function softDeleteLocation(id: string): Promise<void> {
  const ts = nowIso()
  const local = await db.locations.get(id)
  if (local) await db.locations.put({ ...local, deleted_at: ts, updated_at: ts })
  await enqueue({ type: 'delete', entity: 'location', data: { id, updated_at: ts } })
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
 * Bir parçayı bir çekmeceden başka bir çekmeceye taşır (konum revizyonu).
 * Defter mantığıyla: kaynaktan çıkar, hedefe ekle — stok kayıpsız korunur.
 *   • Miktarlı: mevcut adet transfer edilir; kaynak 0'a düşer (listeden gizlenir).
 *   • Doluluk: hedef, kaynağın doluluğunu alır; kaynak BİTTİ olur.
 *   • Takipsiz: hedefte varlık kaydı oluşturulur.
 */
export async function movePartStock(
  part: Part,
  fromLocationId: string,
  toLocationId: string,
  stock: Stock | undefined,
): Promise<void> {
  if (fromLocationId === toLocationId) return

  if (part.count_mode === 'exact') {
    const qty = Number(stock?.qty ?? 0)
    // ref_id iki hareketi aynı transfere bağlar (izlenebilirlik + ileride atomik işleme).
    const refId = uuidv7()
    if (qty !== 0) {
      await moveStock({ partId: part.id, locationId: fromLocationId, delta: -qty, reason: 'transfer', refId })
    }
    await moveStock({ partId: part.id, locationId: toLocationId, delta: qty, reason: 'transfer', refId })
  } else if (part.count_mode === 'level') {
    await setLevel(part.id, toLocationId, stock?.level ?? 'full')
    await setLevel(part.id, fromLocationId, 'empty')
  } else {
    // Takipsiz: varlık işareti taşınır — kaynak −1 ("artık burada değil"), hedef +1.
    // qty < 0 olan takipsiz satırlar listelerde gizlenir (bkz. queries.isExhausted).
    const refId = uuidv7()
    await moveStock({ partId: part.id, locationId: fromLocationId, delta: -1, reason: 'transfer', refId })
    await moveStock({ partId: part.id, locationId: toLocationId, delta: 1, reason: 'transfer', refId })
  }
}

/**
 * Sayım (offline-first): fiziksel sayım sonucunu MUTLAK değer olarak uygular.
 * Yerel qty ile fark (delta = counted - current) hesaplanıp optimistik bir 'audit'
 * hareketi olarak defterlenir — böylece çevrimdışı anında yansır (moveStock/setLevel
 * ile aynı model). Tek cihazda yerel = sunucu olduğundan sonuç doğrudur.
 * (Not: çok cihazlı drift düzeltmesi gereken senaryo için sunucu-yetkili `auditStock`
 *  ayrıca vardır; UI tek-cihaz garaj kullanımı için bu optimistik yolu kullanır.)
 */
export async function countStock(
  partId: string,
  locationId: string,
  countedQty: number,
  currentQty: number,
  note?: string | null,
): Promise<void> {
  const delta = countedQty - currentQty
  if (delta === 0) return
  await moveStock({ partId, locationId, delta, reason: 'audit', note: note ?? null })
}

/**
 * Sayım (sunucu-yetkili): fiziksel sayım mutlak değeri.
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

// --- Ekler (FAZ 2.1 — foto/PDF) ---------------------------------------------

/**
 * Foto/PDF ekle (offline-first): foto istemcide ~1600px JPEG'e küçültülür, sha256
 * hesaplanır, `uploads` kuyruğuna (blob YEREL) yazılır ve sync tetiklenir. Online
 * olunca flushUploads sunucuya iletir; sunucu metadata'sı attachments'a düşer.
 * UI ekleneni ANINDA görür (kuyruk kaydından object URL).
 */
export async function addAttachment(
  ownerType: AttachmentOwnerType,
  ownerId: string,
  file: File | Blob,
  originalName?: string,
): Promise<void> {
  const isPdf = (file.type || '') === 'application/pdf'
  let blob: Blob = file
  let width: number | null = null
  let height: number | null = null
  let kind: AttachmentKind = 'pdf'
  if (!isPdf) {
    const proc = await downscaleImage(file)
    blob = proc.blob
    width = proc.width
    height = proc.height
    kind = 'photo'
  }
  const sha = await sha256Hex(blob)
  const up: PendingUpload = {
    id: uuidv7(),
    owner_type: ownerType,
    owner_id: ownerId,
    kind,
    filename: (originalName || (file as File).name || (isPdf ? 'belge.pdf' : 'foto.jpg')).slice(0, 255),
    mime: isPdf ? 'application/pdf' : 'image/jpeg',
    sha256: sha,
    blob,
    width,
    height,
    created_at: Date.now(),
    attempts: 0,
  }
  await db.uploads.add(up)
  engine.schedule()
}

/** Henüz yüklenmemiş (kuyruktaki) bir eki iptal et — yalnızca yerel. */
export async function cancelPendingUpload(id: string): Promise<void> {
  await db.uploads.delete(id)
}

/** Yüklenmiş bir eki sil: yerel soft-delete + sunucuya delete push (çevrimdışı-uyumlu). */
export async function deleteAttachment(id: string): Promise<void> {
  const ts = nowIso()
  const local = await db.attachments.get(id)
  if (local) await db.attachments.put({ ...local, deleted_at: ts, updated_at: ts })
  await enqueue({ type: 'delete', entity: 'attachment', data: { id, updated_at: ts } })
  engine.schedule()
}
