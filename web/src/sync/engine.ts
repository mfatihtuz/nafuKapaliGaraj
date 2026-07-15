// Senkronizasyon motoru — pull/push döngüsü ve tetikleyiciler (SYNC_PROTOCOL §5.5).
// Sıra: pull → push → pull.

import { getCursor, metaGet, metaSet, BOOTSTRAPPED } from '../db/dexie'
import { api, ApiError } from './api'
import { applyBootstrap, applyChanges, resyncFromServer } from './apply'
import { localStockChecksum } from './checksum'
import { pendingCount, pushOutbox, logSyncEvent } from './outbox'

export interface SyncStatus {
  online: boolean
  syncing: boolean
  lastSyncAt: number | null
  lastError: string | null
  authExpired: boolean
}

/** Self-heal kontrol aralığı: her sync değil, en fazla 5 dakikada bir. */
const CHECKSUM_INTERVAL_MS = 5 * 60 * 1000
const CHECKSUM_LAST = 'checksum_last_at'

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
  private retryTimer: ReturnType<typeof setTimeout> | null = null // bekleyen işi hızlı boşalt
  private drainRounds = 0
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
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.started = false
  }

  /** Outbox'a yazımdan sonra: 500 ms debounce ile sync tetikle. */
  schedule(): void {
    this.drainRounds = 0 // yeni yazım → hızlı boşaltma temposunu sıfırla
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
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null }
    this.emit({ syncing: true, lastError: null })
    try {
      await this.ensureBootstrap()
      await this.pullAll() // pull
      const pushed = await this.pushWithLock() // push (sekmeler-arası tek push)
      // 2. pull YALNIZCA sunucu bir şey uyguladıysa (kendi yazdıklarımızı geri çek).
      // Boşta/başarısız push'ta bu turu atla → gereksiz ağ turu yok (istek sayısı yarıya iner).
      if (pushed.applied > 0) await this.pullAll()
      await this.verifyChecksum() // self-heal: sessiz stok kaymasını yakala
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
      } else {
        void this.scheduleDrainIfPending()
      }
    }
  }

  /**
   * Push yarım kaldıysa (bir tık yavaşlık/kopukluk) bekleyen işleri 5 dakikalık
   * otomatik tura bırakma; birkaç saniyede tekrar dene. Ard arda boşalamazsa
   * gecikmeyi artır (4s→8s→16s→30s tavan) ki sunucuyu dövmesin. Boşalınca sıfırla.
   */
  private async scheduleDrainIfPending(): Promise<void> {
    if (!this.status.online) { this.drainRounds = 0; return }
    const pending = await pendingCount()
    if (pending === 0) { this.drainRounds = 0; return }
    const delay = Math.min(30_000, 4000 * 2 ** Math.min(this.drainRounds, 3))
    this.drainRounds++
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => void this.sync(), delay)
  }

  private async ensureBootstrap(): Promise<void> {
    const done = await metaGet<boolean>(BOOTSTRAPPED, false)
    if (done) return
    const result = await api.bootstrap()
    await applyBootstrap(result)
  }

  /**
   * Outbox push'u sekmeler-arası TEK bağlama indirger (Web Locks, ifAvailable).
   * Aynı origin'de birden çok sekme/PWA aynı IndexedDB outbox'unu paylaşır; hepsi
   * aynı anda push edince sunucu GET_LOCK'unda yarışıp 429 kaskadı olurdu. Kilidi
   * kapan push eder; kapamayan atlar (op'lar paylaşılan outbox'ta kalır, kayıp yok).
   * navigator.locks yoksa (eski iOS Safari / güvensiz bağlam) bugünkü davranış — regresyon yok.
   */
  private async pushWithLock(): Promise<{ applied: number; rejected: number; sent: number }> {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (!locks?.request) return pushOutbox()
    let result = { applied: 0, rejected: 0, sent: 0 }
    await locks.request('depo-outbox-push', { ifAvailable: true }, async (lock) => {
      if (!lock) return // başka sekme zaten boşaltıyor → atla
      result = await pushOutbox()
    })
    return result
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

  /**
   * Self-heal (SYNC_PROTOCOL §5.6): yerel stok özeti sunucununkiyle ayrışırsa
   * (sessiz kayma — türetme hatası, yarım kalmış apply) yeniden bootstrap eder.
   *
   * Güvenlik kapıları — YANLIŞ POZİTİF re-bootstrap döngüsünü önler:
   *  1. Outbox boş değilse ATLA — bekleyen optimistik yazımlar sunucuda henüz yok,
   *     özet doğal olarak ayrışır; ezmek veri kaybı olur.
   *  2. En fazla ~5 dakikada bir kontrol (her hızlı sync değil).
   *  3. crypto.subtle yoksa (güvensiz bağlam) ATLA — özet üretilemez.
   */
  private async verifyChecksum(): Promise<void> {
    if (await pendingCount() > 0) return // bekleyen yazım varken güvenli değil
    const last = await metaGet<number>(CHECKSUM_LAST, 0)
    const now = Date.now()
    if (now - last < CHECKSUM_INTERVAL_MS) return
    await metaSet(CHECKSUM_LAST, now)

    const local = await localStockChecksum()
    if (local === null) return // crypto yok → self-heal devre dışı

    let remote: { checksum: string; rows: number }
    try {
      remote = await api.checksum()
    } catch (err) {
      // 401 dışındaki hatalar self-heal'i atlatır ama sync'i başarısız saymaz
      // (özet doğrulaması opsiyonel bir güvenlik ağıdır, çekirdek akış değil).
      if (err instanceof ApiError && err.status === 401) throw err
      return
    }
    if (remote.checksum === local.checksum) return // hizalı

    // Ayrışma: sunucu doğrudur. Temizle + yeniden bootstrap. Outbox hâlâ boş
    // olduğundan (kapı 1) veri kaybı yok. Görünür logla.
    await resyncFromServer()
    await this.ensureBootstrap()
    await logSyncEvent({
      op_id: 'self-heal', type: 'checksum', reason: 'self_heal',
      message: `Stok özeti ayrıştı (yerel ${local.rows}, sunucu ${remote.rows} satır) — sunucudan yeniden eşitlendi`,
      at: now,
    })
  }
}

export const engine = new SyncEngine()
