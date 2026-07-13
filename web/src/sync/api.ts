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
  const json: unknown = text ? JSON.parse(text) : {}
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

export const api = {
  health: () => request<{ ok: boolean; db: boolean }>('GET', '/health'),
  login: (email: string, password: string) =>
    request<AuthState>('POST', '/auth/login', { email, password }),
  register: (email: string, password: string, display_name: string) =>
    request<AuthState>('POST', '/auth/register', { email, password, display_name }),
  logout: () => request<{ ok: boolean }>('POST', '/auth/logout'),
  me: () => request<AuthState>('GET', '/auth/me'),
  bootstrap: () => request<BootstrapResult>('GET', '/sync/bootstrap'),
  pull: (since: number, limit = 500) =>
    request<PullResult>('GET', `/sync/pull?since=${since}&limit=${limit}`),
  push: (ops: unknown[]) => request<PushResult>('POST', '/sync/push', { ops }),
}
