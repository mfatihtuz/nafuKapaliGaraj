// Yazma aksiyonları. Her yazma: (1) YEREL optimistik güncelle, (2) outbox'a yaz, (3) sync tetikle.
// UI asla doğrudan API'ye yazmaz (ARCHITECTURE §1, SYNC_PROTOCOL §5.4).

import { db } from './dexie'
import type {
  Part, Location, Category, Stock, StockLevel, TxReason, Transaction, OutboxOp,
  AttachmentOwnerType, AttachmentKind, PendingUpload, Project, ProjectStatus, BomItem,
  Supplier, PartSupplier, Loan, PurchaseOrder, PoItem, PoStatus,
} from './types'
import { uuidv7, deterministicUuid } from '../lib/uuid'
import { nowIso } from '../lib/format'
import { foldToAscii } from '../lib/normalize'
import { enqueue } from '../sync/outbox'
import { applyTx } from '../sync/derive'
import { engine } from '../sync/engine'
import { downscaleImage, sha256Hex } from '../lib/image'
import { MAX_ATTEMPTS } from '../sync/uploads'

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

/**
 * Toplu parça içe aktarma (CSV). Parça satırları + upsert op'ları TEK Dexie
 * transaction'ında (atomik, sıra korunur → parça op'u stoktan önce push edilir),
 * sonra istenen başlangıç stoğu (miktar/doluluk) uygulanır. Tek sync tetiği.
 * Parçalar bileşende hazır kurulur (id, sku, tags, buildTags ile) → burada yalnız yazılır.
 */
export interface ImportItem {
  part: Part
  stock?: { locationId: string; delta?: number; level?: StockLevel }
}
export async function importPartsBulk(items: ImportItem[]): Promise<number> {
  if (items.length === 0) return 0
  const ts = nowIso()
  const parts: Part[] = items.map((it) => ({ ...it.part, updated_at: ts }))
  const ops: OutboxOp[] = parts.map((p) => ({
    op_id: uuidv7(), type: 'upsert', entity: 'part', data: p, created_at: Date.now(), attempts: 0,
  }))
  await db.transaction('rw', db.parts, db.outbox, async () => {
    await db.parts.bulkPut(parts)
    await db.outbox.bulkAdd(ops) // ++seq: parça önce, stok sonra
  })
  // Başlangıç stoğu (defter) — moveStock/setLevel applyTx + enqueue yapar.
  for (const it of items) {
    if (!it.stock) continue
    if (it.stock.level) await setLevel(it.part.id, it.stock.locationId, it.stock.level, 'İçe aktarma')
    else if (it.stock.delta && it.stock.delta !== 0) {
      await moveStock({ partId: it.part.id, locationId: it.stock.locationId, delta: it.stock.delta, reason: 'initial' })
    }
  }
  engine.schedule()
  return items.length
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
  txId?: string // verilirse hareket id'si (idempotent geri-alma için deterministik)
}

/** exact mod: qty += delta. Optimistik, ağ beklemez (< 16 ms hedefi). */
export async function moveStock(input: MoveInput): Promise<void> {
  const tx: Transaction = {
    id: input.txId ?? uuidv7(),
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

/** level mod: DOLU/AZ/BİTTİ durumu. opts.reason='transfer' → taşıma bacağı (undo hariç tutar). */
export async function setLevel(
  partId: string,
  locationId: string,
  level: StockLevel,
  note?: string | null,
  opts: { reason?: TxReason; refId?: string; txId?: string } = {},
): Promise<void> {
  const tx: Transaction = {
    id: opts.txId ?? uuidv7(),
    part_id: partId,
    location_id: locationId,
    delta: null,
    level_to: level,
    reason: opts.reason ?? 'adjust',
    project_id: null,
    ref_id: opts.refId ?? null,
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
    // İki bacak da reason 'transfer' + ortak refId → "son hareketi geri al" bunları dışlar
    // (yarım transfer geri alma / hayalet stok önlenir; exact/unmanaged ile aynı korumada).
    const refId = uuidv7()
    await setLevel(part.id, toLocationId, stock?.level ?? 'full', null, { reason: 'transfer', refId })
    await setLevel(part.id, fromLocationId, 'empty', null, { reason: 'transfer', refId })
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

/**
 * Son hareketi geri al: defter append-only olduğundan hareketi SİLMEZ, tersini yazar
 * (SYNC_PROTOCOL — düzeltme = ters kayıt). Yalnızca EN SON hareket için çağrılır, o
 * yüzden önceki (geçerli) duruma döner → stok negatife düşemez.
 *  • Miktarlı: −delta'lık telafi hareketi (reason 'adjust', not 'Geri alma').
 *  • Doluluk: bir önceki doluluğa geri set (prevLevel çağıran tarafça verilir).
 * Transfer (çift bacaklı) geri alınmaz — çağıran taraf düğmeyi göstermez.
 */
export async function undoLastMovement(tx: Transaction, prevLevel: StockLevel | null): Promise<void> {
  // Telafi kaydının id'si kaynak tx'ten DETERMİNİSTİK → aynı geri-alma iki kez uygulanamaz
  // (yerelde applyTx id ile tekler, sunucuda tekrar INSERT PK çakışır → negatif stok olmaz).
  const undoId = await deterministicUuid('undo:' + tx.id)
  if (tx.delta != null && tx.delta !== 0) {
    await moveStock({
      partId: tx.part_id, locationId: tx.location_id, delta: -tx.delta,
      reason: 'adjust', note: 'Geri alma', refId: tx.id, txId: undoId,
    })
  } else if (tx.level_to != null && prevLevel != null) {
    await setLevel(tx.part_id, tx.location_id, prevLevel, 'Geri alma', { reason: 'adjust', txId: undoId })
  }
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
): Promise<'queued' | 'duplicate'> {
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
  // Aynı içerik (sha) bu sahibe zaten ekli/kuyruktaysa yinelemeyi atla (bulgu #11):
  // galeride iki özdeş küçük resim oluşmasın. Farklı sahiplere aynı foto serbest.
  // AMA kalıcı BAŞARISIZ (attempts>=MAX) bir yükleme "ekli" sayılmaz — kullanıcı aynı
  // fotoğrafı yeniden ekleyebilmeli (fix-verify): dedup yalnız aktif/başarılı kayıtlara bakar.
  const dupSynced = await db.attachments
    .where('[owner_type+owner_id]').equals([ownerType, ownerId])
    .filter((a) => !a.deleted_at && a.sha256 === sha).count()
  const dupPending = await db.uploads
    .where('[owner_type+owner_id]').equals([ownerType, ownerId])
    .filter((u) => u.sha256 === sha && u.attempts < MAX_ATTEMPTS).count()
  if (dupSynced > 0 || dupPending > 0) return 'duplicate'
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
  return 'queued'
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

// --- Projeler + BOM (FAZ 3a) ------------------------------------------------

/** 'PRJ-<slug>' benzersiz sanal konum kodu üret (mevcut konum kodlarıyla çakışmaz). */
async function uniqueProjectCode(name: string): Promise<string> {
  const slug = foldToAscii(name).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 16) || 'PRJ'
  const base = `PRJ-${slug}`
  const codes = new Set((await db.locations.toArray()).map((l) => l.code))
  if (!codes.has(base)) return base
  let i = 2
  while (codes.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

/**
 * Proje kaydet/güncelle. Yeni projede sanal konum (type='project', PRJ-*) otomatik kurulur.
 * Konum op'u proje op'undan ÖNCE enqueue edilir (parçalar buraya çekilecek).
 */
export async function saveProject(input: { id?: string; name: string; status?: ProjectStatus; notes?: string | null }): Promise<string> {
  const ts = nowIso()
  const projId = input.id ?? uuidv7()
  const existing = input.id ? await db.projects.get(input.id) : undefined
  let locationId = existing?.location_id ?? null

  // Yeni sanal konum gerekiyorsa kodunu transaction DIŞINDA hazırla (konum tablosunu okur).
  let newLoc: Location | null = null
  if (!locationId) {
    const locId = uuidv7()
    const code = await uniqueProjectCode(input.name)
    newLoc = {
      id: locId, parent_id: null, code, name: input.name, type: 'project', path: code,
      photo_id: null, capacity_note: null, sort_order: 0, updated_at: ts, deleted_at: null,
    }
    locationId = locId
  }

  const proj: Project = {
    id: projId, name: input.name,
    status: input.status ?? existing?.status ?? 'planned',
    location_id: locationId,
    notes: input.notes ?? existing?.notes ?? null,
    updated_at: ts, deleted_at: null,
  }
  // Atomik: konum + proje satırları ve op'ları TEK transaction'da (yarım durum bırakma).
  // Konum op'u proje op'undan ÖNCE (++seq) → FK/mantık sırası korunur.
  const ops: OutboxOp[] = []
  if (newLoc) ops.push({ op_id: uuidv7(), type: 'upsert', entity: 'location', data: newLoc, created_at: Date.now(), attempts: 0 })
  ops.push({ op_id: uuidv7(), type: 'upsert', entity: 'project', data: proj, created_at: Date.now(), attempts: 0 })
  await db.transaction('rw', db.locations, db.projects, db.outbox, async () => {
    if (newLoc) await db.locations.put(newLoc)
    await db.projects.put(proj)
    await db.outbox.bulkAdd(ops)
  })
  engine.schedule()
  return projId
}

/**
 * Projeyi kaldır (arşivle). Proje gözünde stok varsa ENGELLE (elle iade uyarısı — bitiş
 * politikası). BOM satırları + boş sanal konum da soft-delete edilir.
 * @throws Error('PROJECT_HAS_STOCK') proje gözünde stok kaldıysa
 */
export async function softDeleteProject(id: string): Promise<void> {
  const proj = await db.projects.get(id)
  if (!proj) return
  if (proj.location_id) {
    const rows = await db.stock.where('location_id').equals(proj.location_id).toArray()
    if (rows.some((s) => Number(s.qty) > 0 || (s.level != null && s.level !== 'empty'))) {
      throw new Error('PROJECT_HAS_STOCK')
    }
  }
  const ts = nowIso()
  const boms = (await db.bomItems.where('project_id').equals(id).toArray()).filter((b) => !b.deleted_at)
  for (const b of boms) {
    await db.bomItems.put({ ...b, deleted_at: ts, updated_at: ts })
    await enqueue({ type: 'delete', entity: 'bom_item', data: { id: b.id, updated_at: ts } })
  }
  await db.projects.put({ ...proj, deleted_at: ts, updated_at: ts })
  await enqueue({ type: 'delete', entity: 'project', data: { id, updated_at: ts } })
  if (proj.location_id) {
    const loc = await db.locations.get(proj.location_id)
    if (loc && !loc.deleted_at) {
      await db.locations.put({ ...loc, deleted_at: ts, updated_at: ts })
      await enqueue({ type: 'delete', entity: 'location', data: { id: loc.id, updated_at: ts } })
    }
  }
  engine.schedule()
}

export type BomDraft = Omit<BomItem, 'id' | 'project_id' | 'updated_at' | 'deleted_at'>

/**
 * Bir projenin BOM satırlarını toplu yaz. replace=true (varsayılan): mevcut satırları
 * soft-delete edip yenisini kurar (yeniden içe aktarma = değiştir). Tek transaction.
 */
export async function saveBomItemsBulk(projectId: string, drafts: BomDraft[], replace = true): Promise<number> {
  const ts = nowIso()
  const existing = replace
    ? (await db.bomItems.where('project_id').equals(projectId).toArray()).filter((b) => !b.deleted_at)
    : []
  const rows: BomItem[] = drafts.map((d, i) => ({
    id: uuidv7(), project_id: projectId, ...d, sort_order: d.sort_order ?? i, updated_at: ts, deleted_at: null,
  }))
  const ops: OutboxOp[] = []
  for (const b of existing) ops.push({ op_id: uuidv7(), type: 'delete', entity: 'bom_item', data: { id: b.id, updated_at: ts }, created_at: Date.now(), attempts: 0 })
  for (const r of rows) ops.push({ op_id: uuidv7(), type: 'upsert', entity: 'bom_item', data: r, created_at: Date.now(), attempts: 0 })
  await db.transaction('rw', db.bomItems, db.outbox, async () => {
    for (const b of existing) await db.bomItems.put({ ...b, deleted_at: ts, updated_at: ts })
    await db.bomItems.bulkPut(rows)
    await db.outbox.bulkAdd(ops)
  })
  engine.schedule()
  return rows.length
}

/** Tek BOM satırını güncelle (ör. eşleştirme: part_id ata, not değiştir). */
export async function saveBomItem(item: BomItem): Promise<void> {
  const row: BomItem = { ...item, updated_at: nowIso() }
  await db.bomItems.put(row)
  await enqueue({ type: 'upsert', entity: 'bom_item', data: row })
  engine.schedule()
}

export async function deleteBomItem(id: string): Promise<void> {
  const ts = nowIso()
  const local = await db.bomItems.get(id)
  if (local) await db.bomItems.put({ ...local, deleted_at: ts, updated_at: ts })
  await enqueue({ type: 'delete', entity: 'bom_item', data: { id, updated_at: ts } })
  engine.schedule()
}

/**
 * Projeye parça çek: kaynak gözden proje sanal gözüne transfer (iki bacak, ortak refId,
 * project_id defterde). qty çağıran tarafça mevcut stokla SINIRLANIR (negatif önleme).
 * Miktarlı/takipsiz: qty adet. Doluluk: hedef=kaynağın doluluğu, kaynak=BİTTİ.
 */
export async function pullToProject(
  part: Part, fromLocationId: string, projectLocationId: string, qty: number, projectId: string, fromLevel?: StockLevel | null,
): Promise<void> {
  if (fromLocationId === projectLocationId) return
  const refId = uuidv7()
  if (part.count_mode === 'level') {
    await setLevel(part.id, projectLocationId, fromLevel ?? 'full', null, { reason: 'transfer', refId })
    await setLevel(part.id, fromLocationId, 'empty', null, { reason: 'transfer', refId })
  } else {
    const n = Math.max(0, qty)
    if (n === 0) return
    await moveStock({ partId: part.id, locationId: fromLocationId, delta: -n, reason: 'transfer', refId, projectId })
    await moveStock({ partId: part.id, locationId: projectLocationId, delta: n, reason: 'transfer', refId, projectId })
  }
}

/** Projeden çekmeceye iade (pullToProject tersi). */
export async function returnFromProject(
  part: Part, projectLocationId: string, toLocationId: string, qty: number, projectId: string, projectLevel?: StockLevel | null,
): Promise<void> {
  if (projectLocationId === toLocationId) return
  const refId = uuidv7()
  if (part.count_mode === 'level') {
    await setLevel(part.id, toLocationId, projectLevel ?? 'full', null, { reason: 'transfer', refId })
    await setLevel(part.id, projectLocationId, 'empty', null, { reason: 'transfer', refId })
  } else {
    const n = Math.max(0, qty)
    if (n === 0) return
    await moveStock({ partId: part.id, locationId: projectLocationId, delta: -n, reason: 'transfer', refId, projectId })
    await moveStock({ partId: part.id, locationId: toLocationId, delta: n, reason: 'transfer', refId, projectId })
  }
}

/** Proje gözünden tüket (harcandı — tek bacak consume, project_id defterde). */
export async function consumeInProject(part: Part, projectLocationId: string, qty: number, projectId: string): Promise<void> {
  if (part.count_mode === 'level') {
    await setLevel(part.id, projectLocationId, 'empty', null, { reason: 'consume' })
  } else {
    const n = Math.max(0, qty)
    if (n === 0) return
    await moveStock({ partId: part.id, locationId: projectLocationId, delta: -n, reason: 'consume', projectId })
  }
}

// --- Tedarikçiler + fiyat (FAZ 3b — 3.5) ------------------------------------

export async function saveSupplier(input: { id?: string; name: string; website?: string | null }): Promise<string> {
  const ts = nowIso()
  const existing = input.id ? await db.suppliers.get(input.id) : undefined
  const row: Supplier = {
    id: input.id ?? uuidv7(), name: input.name.trim(),
    website: (input.website ?? existing?.website ?? null) || null,
    updated_at: ts, deleted_at: null,
  }
  await db.suppliers.put(row)
  await enqueue({ type: 'upsert', entity: 'supplier', data: row })
  engine.schedule()
  return row.id
}

export async function softDeleteSupplier(id: string): Promise<void> {
  const ts = nowIso()
  const local = await db.suppliers.get(id)
  if (local) await db.suppliers.put({ ...local, deleted_at: ts, updated_at: ts })
  await enqueue({ type: 'delete', entity: 'supplier', data: { id, updated_at: ts } })
  engine.schedule()
}

/**
 * Parça↔tedarikçi bağı + fiyat kaydet/güncelle. id (part|supplier)'dan DETERMİNİSTİK
 * (deterministicUuid) → iki offline cihaz aynı çift için aynı id üretir; uq_ps UNIQUE
 * kısıtı LWW ile birleşir, çift satır / sonsuz-outbox olmaz (tasarım kararı).
 */
export async function savePartSupplier(input: {
  partId: string; supplierId: string; supplierSku?: string | null; productUrl?: string | null;
  lastPrice?: number | null; currency?: string
}): Promise<string> {
  const ts = nowIso()
  const id = await deterministicUuid(`ps:${input.partId}|${input.supplierId}`)
  const existing = await db.partSuppliers.get(id)
  const priceChanged = input.lastPrice != null && input.lastPrice !== existing?.last_price
  const row: PartSupplier = {
    id, part_id: input.partId, supplier_id: input.supplierId,
    supplier_sku: (input.supplierSku ?? existing?.supplier_sku ?? null) || null,
    product_url: (input.productUrl ?? existing?.product_url ?? null) || null,
    last_price: input.lastPrice ?? existing?.last_price ?? null,
    currency: input.currency ?? existing?.currency ?? 'TRY',
    last_price_at: priceChanged ? ts : (existing?.last_price_at ?? null),
    updated_at: ts, deleted_at: null,
  }
  await db.partSuppliers.put(row)
  await enqueue({ type: 'upsert', entity: 'part_supplier', data: row })
  engine.schedule()
  return id
}

export async function deletePartSupplier(id: string): Promise<void> {
  const ts = nowIso()
  const local = await db.partSuppliers.get(id)
  if (local) await db.partSuppliers.put({ ...local, deleted_at: ts, updated_at: ts })
  await enqueue({ type: 'delete', entity: 'part_supplier', data: { id, updated_at: ts } })
  engine.schedule()
}

// --- Ödünç (FAZ 3b — 3.4) ---------------------------------------------------

/**
 * Borçlu-başına 'LOAN-<slug>' sanal konumu bul-veya-oluştur. Aynı borçluya verilen tüm
 * ödünçler TEK gözde toplanır (borçlu bazlı görünüm).
 *
 * id borçlu slug'ından DETERMİNİSTİK (part_supplier ile aynı kalıp — inceleme bulgusu #1/#3):
 * iki ÇEVRİMDIŞI cihaz aynı yeni borçluya ödünç verince AYNI id + AYNI code üretir → uq_loc_code
 * UNIQUE çakışması olmaz, LWW upsert tek satırda birleşir. (Rastgele uuid ile kod aynı/id farklı
 * olur, ikinci cihazın konumu kalıcı reddedilir → hayalet location_id + dengesiz defter.)
 * Farklı borçlu aynı slug'a düşerse aynı gözü paylaşır (nadir; kabul edilebilir).
 */
async function loanLocationForBorrower(borrower: string): Promise<{ id: string; created: Location | null }> {
  const slug = foldToAscii(borrower).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 16) || 'X'
  const code = `LOAN-${slug}`
  const id = await deterministicUuid('loanloc:' + slug)
  const existing = await db.locations.get(id)
  if (existing && !existing.deleted_at) return { id, created: null }
  const ts = nowIso()
  const loc: Location = {
    id, parent_id: null, code, name: borrower, type: 'loan', path: code,
    photo_id: null, capacity_note: null, sort_order: 0, updated_at: ts, deleted_at: null,
  }
  return { id, created: loc }
}

/**
 * Parçayı ödünç ver: kaynak gözden borçlunun LOAN-* gözüne transfer (iki bacak, reason
 * 'loan_out', ref_id=loanId) + ödünç kaydı (LWW). Konum + ödünç kaydı TEK yerel transaction'da;
 * stok bacakları defter (moveStock) ile. qty mevcut stokla SINIRLANIR (çağıran taraf clamp'ler).
 * @throws Error('BORROWER_REQUIRED') | Error('QTY_ZERO')
 */
export async function lendPart(input: {
  part: Part; fromLocationId: string; qty: number; borrower: string;
  borrowerContact?: string | null; dueAt?: string | null; note?: string | null; fromLevel?: StockLevel | null;
}): Promise<string> {
  const { part } = input
  const borrower = input.borrower.trim()
  if (!borrower) throw new Error('BORROWER_REQUIRED')
  const isLevel = part.count_mode === 'level'
  const n = isLevel ? 1 : Math.max(0, Math.floor(input.qty))
  if (!isLevel && n === 0) throw new Error('QTY_ZERO')

  const { id: loanLocId, created: newLoc } = await loanLocationForBorrower(borrower)
  const ts = nowIso()
  const loanId = uuidv7()
  const loan: Loan = {
    id: loanId, part_id: part.id, qty: n, borrower,
    borrower_contact: (input.borrowerContact ?? null) || null,
    location_id: loanLocId, out_at: ts, due_at: input.dueAt ?? null,
    returned_at: null, note: (input.note ?? null) || null,
    updated_at: ts, deleted_at: null,
  }
  // Konum (gerekiyorsa) + ödünç kaydı atomik; konum op'u ödünç op'undan ÖNCE (FK sırası).
  const ops: OutboxOp[] = []
  if (newLoc) ops.push({ op_id: uuidv7(), type: 'upsert', entity: 'location', data: newLoc, created_at: Date.now(), attempts: 0 })
  ops.push({ op_id: uuidv7(), type: 'upsert', entity: 'loan', data: loan, created_at: Date.now(), attempts: 0 })
  await db.transaction('rw', db.locations, db.loans, db.outbox, async () => {
    if (newLoc) await db.locations.put(newLoc)
    await db.loans.put(loan)
    await db.outbox.bulkAdd(ops)
  })
  // Stok: kaynaktan çıkar, LOAN gözüne ekle (reason loan_out, ref_id=loanId).
  const refId = loanId
  if (isLevel) {
    await setLevel(part.id, loanLocId, input.fromLevel ?? 'full', null, { reason: 'loan_out', refId })
    await setLevel(part.id, input.fromLocationId, 'empty', null, { reason: 'loan_out', refId })
  } else {
    await moveStock({ partId: part.id, locationId: input.fromLocationId, delta: -n, reason: 'loan_out', refId })
    await moveStock({ partId: part.id, locationId: loanLocId, delta: n, reason: 'loan_out', refId })
  }
  engine.schedule()
  return loanId
}

/**
 * Ödüncü iade al: borçlunun LOAN-* gözünden hedef göze geri transfer (reason 'loan_return',
 * ref_id=loanId) + ödünç kaydını KAPAT (returned_at LWW upsert — SİLİNMEZ). Tam iade.
 * Bacak id'leri loanId'den DETERMİNİSTİK → aynı iade iki kez uygulanmaz (idempotent).
 */
export async function returnLoan(
  loan: Loan, part: Part, toLocationId: string, loanLevel?: StockLevel | null,
): Promise<void> {
  if (loan.returned_at) return // zaten kapalı
  const refId = loan.id
  if (part.count_mode === 'level') {
    const tIn = await deterministicUuid('loanret:in:' + loan.id)
    await setLevel(part.id, toLocationId, loanLevel ?? 'full', null, { reason: 'loan_return', refId, txId: tIn })
    // Doluluk modunda göz TEK durumludur (adet yok). Aynı borçlunun LOAN gözünde/parçada
    // BAŞKA açık ödünç kaldıysa gözü boşaltma — erken 'empty' diğer ödüncün stoğunu kaybeder
    // (inceleme bulgusu #4). Yalnız SON iade gözü boşaltır.
    const others = (await db.loans.where('part_id').equals(part.id).toArray())
      .filter((l) => l.id !== loan.id && l.location_id === loan.location_id && !l.deleted_at && !l.returned_at)
    if (others.length === 0) {
      const tOut = await deterministicUuid('loanret:out:' + loan.id)
      await setLevel(part.id, loan.location_id, 'empty', null, { reason: 'loan_return', refId, txId: tOut })
    }
  } else {
    const n = Math.max(0, Number(loan.qty))
    if (n > 0) {
      const tOut = await deterministicUuid('loanret:out:' + loan.id)
      const tIn = await deterministicUuid('loanret:in:' + loan.id)
      await moveStock({ partId: part.id, locationId: loan.location_id, delta: -n, reason: 'loan_return', refId, txId: tOut })
      await moveStock({ partId: part.id, locationId: toLocationId, delta: n, reason: 'loan_return', refId, txId: tIn })
    }
  }
  const ts = nowIso()
  const closed: Loan = { ...loan, returned_at: ts, updated_at: ts }
  await db.loans.put(closed)
  await enqueue({ type: 'upsert', entity: 'loan', data: closed })
  engine.schedule()
}

/** Ödünç kaydının metadata'sını güncelle (vade/not/iletişim). Stok DEĞİŞTİRMEZ. */
export async function saveLoan(loan: Loan): Promise<void> {
  const row: Loan = { ...loan, updated_at: nowIso() }
  await db.loans.put(row)
  await enqueue({ type: 'upsert', entity: 'loan', data: row })
  engine.schedule()
}

// --- Sipariş / PO (FAZ 3b — 3.6) --------------------------------------------

/** Sipariş (PO) oluştur/güncelle. Yeni PO 'draft' başlar; teslim akışı stoğu 'purchase' defteriyle işler. */
export async function savePurchaseOrder(input: {
  id?: string; supplierId?: string | null; status?: PoStatus; note?: string | null; currency?: string
}): Promise<string> {
  const ts = nowIso()
  const existing = input.id ? await db.purchaseOrders.get(input.id) : undefined
  const row: PurchaseOrder = {
    id: input.id ?? uuidv7(),
    supplier_id: input.supplierId ?? existing?.supplier_id ?? null,
    status: input.status ?? existing?.status ?? 'draft',
    ordered_at: existing?.ordered_at ?? null,
    received_at: existing?.received_at ?? null,
    total: existing?.total ?? null,
    currency: input.currency ?? existing?.currency ?? 'TRY',
    note: (input.note ?? existing?.note ?? null) || null,
    updated_at: ts, deleted_at: null,
  }
  await db.purchaseOrders.put(row)
  await enqueue({ type: 'upsert', entity: 'purchase_order', data: row })
  engine.schedule()
  return row.id
}

/** PO durumunu değiştir; ordered_at/received_at damgalarını uygun şekilde doldurur (LWW). */
export async function setPoStatus(po: PurchaseOrder, status: PoStatus): Promise<void> {
  const ts = nowIso()
  const row: PurchaseOrder = {
    ...po, status,
    ordered_at: status === 'ordered' && !po.ordered_at ? ts : po.ordered_at,
    received_at: status === 'received' ? ts : (status === 'draft' || status === 'ordered' ? null : po.received_at),
    updated_at: ts,
  }
  await db.purchaseOrders.put(row)
  await enqueue({ type: 'upsert', entity: 'purchase_order', data: row })
  engine.schedule()
}

/** PO'yu kaldır (arşivle). Satırları da SOFT-delete edilir (sunucu da cascade eder). */
export async function softDeletePurchaseOrder(id: string): Promise<void> {
  const po = await db.purchaseOrders.get(id)
  if (!po) return
  const ts = nowIso()
  const items = (await db.poItems.where('po_id').equals(id).toArray()).filter((i) => !i.deleted_at)
  for (const it of items) {
    await db.poItems.put({ ...it, deleted_at: ts, updated_at: ts })
    await enqueue({ type: 'delete', entity: 'po_item', data: { id: it.id, updated_at: ts } })
  }
  await db.purchaseOrders.put({ ...po, deleted_at: ts, updated_at: ts })
  await enqueue({ type: 'delete', entity: 'purchase_order', data: { id, updated_at: ts } })
  engine.schedule()
}

/** Sipariş satırı ekle/güncelle. part_id yoksa raw_name (katalogda olmayan parça — teslim alınamaz). */
export async function savePoItem(input: {
  id?: string; poId: string; partId?: string | null; rawName?: string | null;
  qty: number; unitPrice?: number | null; targetLocationId?: string | null;
}): Promise<string> {
  const ts = nowIso()
  const existing = input.id ? await db.poItems.get(input.id) : undefined
  const row: PoItem = {
    id: input.id ?? uuidv7(), po_id: input.poId,
    part_id: input.partId ?? existing?.part_id ?? null,
    raw_name: (input.rawName ?? existing?.raw_name ?? null) || null,
    qty: input.qty ?? existing?.qty ?? 0,
    unit_price: input.unitPrice ?? existing?.unit_price ?? null,
    received_qty: existing?.received_qty ?? 0,
    target_location_id: input.targetLocationId ?? existing?.target_location_id ?? null,
    updated_at: ts, deleted_at: null,
  }
  await db.poItems.put(row)
  await enqueue({ type: 'upsert', entity: 'po_item', data: row })
  engine.schedule()
  return row.id
}

export async function deletePoItem(id: string): Promise<void> {
  const ts = nowIso()
  const local = await db.poItems.get(id)
  if (local) await db.poItems.put({ ...local, deleted_at: ts, updated_at: ts })
  await enqueue({ type: 'delete', entity: 'po_item', data: { id, updated_at: ts } })
  engine.schedule()
}

/**
 * Sipariş satırını teslim al: hedef göze 'purchase' hareketi (ref_id=po_item.id) + received_qty
 * artışı (LWW). Ham satır (part_id yok) teslim alınamaz — önce parçaya eşleştir.
 * @throws Error('PO_ITEM_NO_PART') | Error('QTY_ZERO')
 */
export async function receivePoItem(item: PoItem, targetLocationId: string, receiveQty: number): Promise<void> {
  if (!item.part_id) throw new Error('PO_ITEM_NO_PART')
  const n = Math.max(0, receiveQty)
  if (n === 0) throw new Error('QTY_ZERO')
  // Sayım moduna göre stok işle (inceleme bulgusu #2): doluluk (level) modunda adet yoktur —
  // teslim hedef gözü DOLU yapar; aksi hâlde exact/takipsiz gibi delta yazılıp hayalet qty oluşurdu.
  const part = await db.parts.get(item.part_id)
  if (part?.count_mode === 'level') {
    await setLevel(item.part_id, targetLocationId, 'full', null, { reason: 'purchase', refId: item.id })
  } else {
    await moveStock({ partId: item.part_id, locationId: targetLocationId, delta: n, reason: 'purchase', refId: item.id })
  }
  const ts = nowIso()
  const updated: PoItem = {
    ...item, received_qty: Number(item.received_qty) + n,
    target_location_id: targetLocationId, updated_at: ts,
  }
  await db.poItems.put(updated)
  await enqueue({ type: 'upsert', entity: 'po_item', data: updated })
  engine.schedule()
}

/**
 * Eksiklerden taslak sipariş oluştur (feasibility/alışveriş köprüsü — 3.2↔3.6). PO + satırlar
 * TEK yerel transaction'da; PO op'u satır op'larından ÖNCE (FK fk_poi_po sırası). Döner: poId.
 */
export async function createPoFromShortages(
  lines: { partId: string; qty: number; unitPrice?: number | null }[],
  supplierId?: string | null,
): Promise<string> {
  const ts = nowIso()
  const poId = uuidv7()
  const po: PurchaseOrder = {
    id: poId, supplier_id: supplierId ?? null, status: 'draft', ordered_at: null,
    received_at: null, total: null, currency: 'TRY', note: null, updated_at: ts, deleted_at: null,
  }
  const items: PoItem[] = lines.map((l) => ({
    id: uuidv7(), po_id: poId, part_id: l.partId, raw_name: null,
    qty: l.qty, unit_price: l.unitPrice ?? null, received_qty: 0,
    target_location_id: null, updated_at: ts, deleted_at: null,
  }))
  const ops: OutboxOp[] = [{ op_id: uuidv7(), type: 'upsert', entity: 'purchase_order', data: po, created_at: Date.now(), attempts: 0 }]
  for (const it of items) ops.push({ op_id: uuidv7(), type: 'upsert', entity: 'po_item', data: it, created_at: Date.now(), attempts: 0 })
  await db.transaction('rw', db.purchaseOrders, db.poItems, db.outbox, async () => {
    await db.purchaseOrders.put(po)
    await db.poItems.bulkPut(items)
    await db.outbox.bulkAdd(ops)
  })
  engine.schedule()
  return poId
}
