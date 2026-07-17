// API istemcisi — sync motorunun konuştuğu TEK katman (ARCHITECTURE §1).
// UI bunu doğrudan çağırmaz; daima IndexedDB'den okur.

import type { AuthState } from '../db/types'

const API_BASE = import.meta.env.BASE_URL.replace(/\/+$/, '') + '/api'

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

const REQUEST_TIMEOUT_MS = 20000

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // Zaman aşımı: takılan bir bağlantı girişi/eşitlemeyi sonsuza dek dondurmasın.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(API_BASE + path, {
      method,
      credentials: 'include',
      // API yanıtları taze olmalı: tarayıcının HTTP cache'ini tamamen atla. Aksi hâlde
      // GET /sync/bootstrap gibi istekler eski önbellekten döner ve çıkış/giriş yapılsa
      // bile güncellenmiş kategori/konum ağacı inmez (bkz. sunucu no-store başlığı).
      cache: 'no-store',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    throw new ApiError(0, aborted ? 'timeout' : 'network', aborted ? 'Sunucu yanıt vermedi (zaman aşımı)' : 'Ağ hatası')
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text()
  let json: unknown = {}
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      // Paylaşımlı hosting hata sayfası / captive portal HTML dönebilir —
      // ham SyntaxError yerine anlaşılır, yakalanabilir bir hata üret.
      throw new ApiError(res.status, 'bad_response', 'Sunucudan beklenmeyen yanıt alındı')
    }
  }
  if (!res.ok) {
    const obj = json as { error?: string; message?: string }
    throw new ApiError(res.status, obj.error ?? 'error', obj.message ?? res.statusText)
  }
  return json as T
}

export interface PushResult {
  applied: string[]
  rejected: { op_id: string; reason: string; message?: string }[]
  cursor: number
}

export interface PullResult {
  changes: { seq: number; entity: string; entity_id: string; op: 'upsert' | 'delete'; payload: Record<string, unknown> }[]
  cursor: number
  has_more: boolean
}

export interface BootstrapResult {
  tenant: AuthState['tenant']
  categories: Record<string, unknown>[]
  locations: Record<string, unknown>[]
  parts: Record<string, unknown>[]
  attachments: Record<string, unknown>[]
  projects: Record<string, unknown>[]
  bom_items: Record<string, unknown>[]
  suppliers: Record<string, unknown>[]
  part_suppliers: Record<string, unknown>[]
  loans: Record<string, unknown>[]
  purchase_orders: Record<string, unknown>[]
  po_items: Record<string, unknown>[]
  stock_snapshot: Record<string, unknown>[]
  stock_transactions: Record<string, unknown>[]
  cursor: number
  server_time: string
}

/** Multipart yükleme — JSON request()'ten ayrı (boundary'yi tarayıcı koyar). */
async function uploadForm<T>(path: string, form: FormData): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 60000) // yükleme daha uzun sürebilir
  let res: Response
  try {
    res = await fetch(API_BASE + path, {
      method: 'POST', credentials: 'include', cache: 'no-store', body: form, signal: ctrl.signal,
    })
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    throw new ApiError(0, aborted ? 'timeout' : 'network', aborted ? 'Yükleme zaman aşımı' : 'Ağ hatası')
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text()
  let json: unknown = {}
  if (text) {
    try { json = JSON.parse(text) } catch { throw new ApiError(res.status, 'bad_response', 'Sunucudan beklenmeyen yanıt') }
  }
  if (!res.ok) {
    const o = json as { error?: string; message?: string }
    throw new ApiError(res.status, o.error ?? 'error', o.message ?? res.statusText)
  }
  return json as T
}

export interface AiStatus { ai_enabled: boolean; mpn_enabled: boolean }
export interface AiIdentifyResult {
  ai_enabled: boolean
  reason?: string
  suggestion?: Record<string, unknown> | null
}

export interface OrgUser {
  id: string
  email: string | null
  username: string | null
  display_name: string
  role: 'owner' | 'member' | 'viewer'
  created_at: string
}

export const api = {
  health: () => request<{ ok: boolean; db: boolean }>('GET', '/health'),
  // identifier: kullanıcı adı veya e-posta
  login: (identifier: string, password: string) =>
    request<AuthState>('POST', '/auth/login', { email: identifier, password }),
  register: (email: string, password: string, display_name: string) =>
    request<AuthState>('POST', '/auth/register', { email, password, display_name }),
  logout: () => request<{ ok: boolean }>('POST', '/auth/logout'),
  me: () => request<AuthState>('GET', '/auth/me'),
  bootstrap: () => request<BootstrapResult>('GET', '/sync/bootstrap'),
  pull: (since: number, limit = 500) =>
    request<PullResult>('GET', `/sync/pull?since=${since}&limit=${limit}`),
  checksum: () => request<{ checksum: string; rows: number; server_time: string }>('GET', '/sync/checksum'),
  push: (ops: unknown[]) => request<PushResult>('POST', '/sync/push', { ops }),

  // Hesap
  changePassword: (current_password: string, new_password: string) =>
    request<{ ok: boolean }>('POST', '/account/password', { current_password, new_password }),
  updateProfile: (data: { display_name?: string; email?: string; username?: string }) =>
    request<{ user: OrgUser }>('POST', '/account/profile', data),

  // Organizasyon (owner)
  listUsers: () => request<{ users: OrgUser[] }>('GET', '/org/users'),
  createUser: (data: { username?: string; email?: string; password: string; display_name: string; role: string }) =>
    request<{ user: OrgUser }>('POST', '/org/users', data),
  setUserRole: (user_id: string, role: string) =>
    request<{ ok: boolean }>('POST', '/org/users/role', { user_id, role }),
  removeUser: (user_id: string) => request<{ ok: boolean }>('POST', '/org/users/remove', { user_id }),
  resetUserPassword: (user_id: string, password: string) =>
    request<{ ok: boolean }>('POST', '/org/users/password', { user_id, password }),
  renameOrg: (name: string) => request<{ tenant: { id: string; name: string } }>('POST', '/org/rename', { name }),
  updateOrgSettings: (settings: Record<string, unknown>) =>
    request<{ settings: Record<string, unknown> }>('POST', '/org/settings', { settings }),

  // Ekler (FAZ 2.1) — ikili yükleme (multipart). Meta döner → Dexie'ye yazılır.
  // id: istemci PendingUpload.id'si → sunucu bunu attachment PK'sı yapar. Aynı yüklemenin
  // tekrarı (timeout/reload sonrası) İDEMPOTENT olur; ikinci satır oluşmaz (bulgu #4).
  uploadAttachment: (id: string, ownerType: string, ownerId: string, blob: Blob, filename: string) => {
    const form = new FormData()
    form.append('id', id)
    form.append('owner_type', ownerType)
    form.append('owner_id', ownerId)
    form.append('file', blob, filename)
    return uploadForm<Record<string, unknown>>('/files', form)
  },

  // AI tanıma (FAZ 2.3) + MPN (2.5) — kapalıysa 200 + disabled döner.
  aiStatus: () => request<AiStatus>('GET', '/ai/status'),
  aiIdentify: (image_base64: string, media_type: string) =>
    request<AiIdentifyResult>('POST', '/ai/identify', { image_base64, media_type }),
  mpnLookup: (mpn: string) => request<{ mpn_enabled: boolean; results?: unknown[] }>('GET', `/lookup/mpn?mpn=${encodeURIComponent(mpn)}`),
}
