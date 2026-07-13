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
  entity?: 'part' | 'location' | 'category'
  data: unknown
  created_at: number
  attempts: number
  last_error?: string
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
  } | null
}

/** Etiket tipi — kullanıcı tanımlı format + eldeki adet. */
export interface LabelType {
  id: string
  name: string
  w_mm: number
  h_mm: number
  cols: number
  rows: number
  qty: number
}

export interface AuthState {
  user: { id: string; email: string | null; username?: string | null; display_name: string }
  tenant: TenantInfo
  role: 'owner' | 'member' | 'viewer'
}
