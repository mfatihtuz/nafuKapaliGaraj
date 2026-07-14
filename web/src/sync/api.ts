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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
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
  stock_snapshot: Record<string, unknown>[]
  stock_transactions: Record<string, unknown>[]
  cursor: number
  server_time: string
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
  renameOrg: (name: string) => request<{ tenant: { id: string; name: string } }>('POST', '/org/rename', { name }),
  updateOrgSettings: (settings: Record<string, unknown>) =>
    request<{ settings: Record<string, unknown> }>('POST', '/org/settings', { settings }),
}
