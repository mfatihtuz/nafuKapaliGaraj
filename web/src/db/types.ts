// DEPO — paylaşılan tipler. db/schema.sql ile birebir uyumlu.

export type CountMode = 'exact' | 'level' | 'unmanaged'
export type StockLevel = 'full' | 'low' | 'empty'
export type AbcClass = 'A' | 'B' | 'C'

export type TxReason =
  | 'purchase' | 'consume' | 'transfer' | 'adjust'
  | 'audit' | 'scrap' | 'loan_out' | 'loan_return' | 'initial'

export type LocationType =
  | 'site' | 'cabinet' | 'shelf' | 'drawer' | 'bin'
  | 'bench' | 'intake' | 'quarantine' | 'loan' | 'project'

/** Kategori öznitelik şablonu tanımı (attribute_schema JSON içindeki her öğe). */
export interface AttributeDef {
  key: string
  label_tr: string
  label_en?: string
  type: 'text' | 'number' | 'enum'
  unit?: string
  options?: string[]
  required?: boolean
  in_sku?: boolean
  order?: number
}

export interface Category {
  id: string
  parent_id: string | null
  name_tr: string
  name_en: string | null
  code: string
  attribute_schema: AttributeDef[] | null
  sku_template: string | null
  default_count_mode: CountMode
  sort_order: number
  updated_at: string
  deleted_at: string | null
}

export interface Location {
  id: string
  parent_id: string | null
  code: string
  name: string | null
  type: LocationType
  path: string
  photo_id: string | null
  capacity_note: string | null
  sort_order: number
  updated_at: string
  deleted_at: string | null
}

export type PartAttributes = Record<string, string | number | null>

export interface Part {
  id: string
  category_id: string | null
  sku: string
  name: string
  mpn: string | null
  manufacturer: string | null
  attributes: PartAttributes | null
  tags: string | null
  count_mode: CountMode
  abc_class: AbcClass
  min_qty: number | null
  unit: string
  datasheet_url: string | null
  photo_id: string | null
  notes: string | null
  updated_at: string
  deleted_at: string | null
}

/** Yerel stok görünümü (defterden türetilir). Anahtar: `${part_id}|${location_id}`. */
export interface Stock {
  key: string
  part_id: string
  location_id: string
  qty: number
  level: StockLevel | null
  level_at: string | null
  last_move_at: string | null
}

export interface Transaction {
  id: string
  part_id: string
  location_id: string
  delta: number | null
  level_to: StockLevel | null
  reason: TxReason
  project_id: string | null
  ref_id: string | null
  note: string | null
  actor_id: string | null
  created_at: string
}

export type OutboxType = 'upsert' | 'delete' | 'stock_move' | 'stock_audit'

export interface OutboxOp {
  seq?: number // ++auto-increment — kuyruk sırasını KARARLI tutar (Date.now() eşitliklerine karşı)
  op_id: string
  type: OutboxType
  entity?: 'part' | 'location' | 'category' | 'attachment'
  data: unknown
  created_at: number
  attempts: number
  last_error?: string
  last_attempt_at?: number // son gerçek deneme zamanı (üstel bekleme için)
}

// --- Ekler (FAZ 2.1 — foto/PDF) --------------------------------------------

export type AttachmentKind = 'photo' | 'pdf'
export type AttachmentOwnerType = 'part' | 'location'

/**
 * Ek METADATA'sı — senkronlanan katalog varlığı (LWW). İkili (blob) BURADA yok:
 * yüklenmiş ekin baytı sunucudan <img src="/api/files/:id?thumb=1"> ile gelir
 * (immutable cache → offline'da da açılır). Kendi yeni çektiğin foto ise
 * sunucuya iletilene dek `uploads` tablosunda (PendingUpload) tutulur.
 */
export interface Attachment {
  id: string
  owner_type: AttachmentOwnerType
  owner_id: string
  kind: AttachmentKind
  filename: string
  mime: string
  size_bytes: number
  sha256: string
  width: number | null
  height: number | null
  sort_order: number
  updated_at: string
  deleted_at: string | null
}

/** Giden yükleme kuyruğu — blob YALNIZCA sunucuya iletilene dek yerelde tutulur. */
export interface PendingUpload {
  id: string // yerel geçici id (uuidv7)
  owner_type: AttachmentOwnerType
  owner_id: string
  kind: AttachmentKind
  filename: string
  mime: string
  sha256: string
  blob: Blob
  width: number | null
  height: number | null
  created_at: number
  attempts: number
  last_error?: string
  last_attempt_at?: number
}

export interface MetaRow {
  key: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- meta serbest biçimli KV deposu
  value: any
}

export interface TenantInfo {
  id: string
  name: string
  locale: string
  settings?: {
    qr_base_url?: string
    label_grid?: { w_mm: number; h_mm: number; cols: number; rows: number }
    label_types?: LabelType[]
    default_count_mode?: CountMode
    /** Hassas sayım (B4): açıkken ve online iken sayım sunucu-yetkili işlenir
     *  (çok cihazlı doğruluk). Kapalı (varsayılan) = anlık/optimistik. */
    precise_count?: boolean
  } | null
}

/** Etiket tipi — kullanıcı tanımlı format + eldeki adet + bağlı dolaplar. */
export interface LabelType {
  id: string
  name: string
  w_mm: number
  h_mm: number
  cols: number
  rows: number
  qty: number
  /** Bu tipin kullanıldığı dolapların konum id'leri — Etiket Yazdır'da dolap
   *  seçilince tip otomatik gelir. Boş/tanımsız = bağ yok. */
  cabinets?: string[]
}

export interface AuthState {
  user: { id: string; email: string | null; username?: string | null; display_name: string }
  tenant: TenantInfo
  role: 'owner' | 'member' | 'viewer'
}
