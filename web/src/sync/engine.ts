// Senkronizasyon motoru — pull/push döngüsü ve tetikleyiciler (SYNC_PROTOCOL §5.5).
// Sıra: pull → push → pull.

import { getCursor, metaGet, BOOTSTRAPPED } from '../db/dexie'
import { api, ApiError } from './api'
import { applyBootstrap, applyChanges } from './apply'
import { pushOutbox } from './outbox'

export interface SyncStatus {
  online: boolean
  syncing: boolean
  lastSyncAt: number | null
  lastError: string | null
  authExpired: boolean
}

type Listener = (s: SyncStatus) => void

class SyncEngine {
  private status: SyncStatus = {
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    syncing: false,
    lastSyncAt: null,
    lastError: null,
    authExpired: false,
  }
  private listeners = new Set<Listener>()
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private intervalTimer: ReturnType<typeof setInterval> | null = null
  private runQueued = false
  private started = false

  // İsimli dinleyiciler — stop()'ta kaldırılabilsin (birikmeyi önle).
  private onOnline = () => { this.emit({ online: true }); void this.sync() }
  private onOffline = () => this.emit({ online: false })
  private onVisible = () => { if (document.visibilityState === 'visible') void this.sync() }

  getStatus(): SyncStatus {
    return { ...this.status }
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb)
    cb(this.getStatus())
    return () => this.listeners.delete(cb)
  }

  private emit(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch }
    for (const l of this.listeners) l(this.getStatus())
  }

  /** Uygulama başlangıcında bir kez: dinleyicileri kur, ilk sync. */
  start(): void {
    if (this.started) return
    this.started = true

    window.addEventListener('online', this.onOnline)
    window.addEventListener('offline', this.onOffline)
    document.addEventListener('visibilitychange', this.onVisible)
    // Her 5 dakikada bir (online ve ön plandaysa)
    this.intervalTimer = setInterval(() => {
      if (this.status.online && document.visibilityState === 'visible') void this.sync()
    }, 5 * 60 * 1000)

    void this.sync()
  }

  stop(): void {
    window.removeEventListener('online', this.onOnline)
    window.removeEventListener('offline', this.onOffline)
    document.removeEventListener('visibilitychange', this.onVisible)
    if (this.intervalTimer) clearInterval(this.intervalTimer)
    this.intervalTimer = null
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = null
    this.started = false
  }

  /** Outbox'a yazımdan sonra: 500 ms debounce ile sync tetikle. */
  schedule(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => void this.sync(), 500)
  }

  /** Ana senkronizasyon rutini. Eşzamanlı çağrılar tek koşuya indirgenir. */
  async sync(): Promise<void> {
    if (!this.status.online) return
    if (this.status.syncing) {
      this.runQueued = true
      return
    }
    this.emit({ syncing: true, lastError: null })
    try {
      await this.ensureBootstrap()
      await this.pullAll() // pull
      await pushOutbox() //   push
      await this.pullAll() // pull (push sonrası kendi değişikliklerimizi de al)
      this.emit({ lastSyncAt: Date.now(), lastError: null, authExpired: false })
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        this.emit({ authExpired: true, lastError: 'Oturum süresi doldu' })
      } else {
        const msg = err instanceof Error ? err.message : 'Senkronizasyon hatası'
        this.emit({ lastError: msg })
      }
    } finally {
      this.emit({ syncing: false })
      if (this.runQueued) {
        this.runQueued = false
        void this.sync()
      }
    }
  }

  private async ensureBootstrap(): Promise<void> {
    const done = await metaGet<boolean>(BOOTSTRAPPED, false)
    if (done) return
    const result = await api.bootstrap()
    await applyBootstrap(result)
  }

  private async pullAll(): Promise<void> {
    // has_more true olduğu sürece devam et
    for (let guard = 0; guard < 1000; guard++) {
      const since = await getCursor()
      const result = await api.pull(since, 500)
      await applyChanges(result)
      if (!result.has_more) break
    }
  }
}

export const engine = new SyncEngine()
