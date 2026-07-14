// Dağıtım-güvenli tembel yükleme (lazy import).
//
// SORUN: Yeni sürüm sunucuya yüklenince, eski önbellekli istemcinin index.html'i
// artık var olmayan chunk adlarını (hash'leri) işaret edebilir. O chunk YÜKLENEMEZ
// (404) ya da service worker güncellenirken istek ASILI kalır. Error boundary yoksa
// React.lazy + Suspense sonsuza dek "Yükleniyor…" ekranında takılır — kullanıcının
// Ctrl+Shift+R'de yaşadığı donma tam olarak budur.
//
// ÇÖZÜM: Import başarısız olursa veya belirli sürede gelmezse, oturumda BİR KEZ
// sayfayı yenile (taze index.html + chunk'lar gelir). İkinci denemede de olmazsa
// hatayı yükselt → ErrorBoundary anlaşılır bir "Yeniden yükle" ekranı gösterir.

import { lazy, type ComponentType } from 'react'

const RELOAD_KEY = 'depo:chunk-reloaded'
const CHUNK_TIMEOUT_MS = 15000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('chunk-timeout')), ms)),
  ])
}

/** React.lazy'nin dağıtım-dayanıklı sürümü. */
export function lazyReload<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const mod = await withTimeout(factory(), CHUNK_TIMEOUT_MS)
      sessionStorage.removeItem(RELOAD_KEY) // başarı → sayaç sıfırlanır
      return mod
    } catch (err) {
      // Daha önce bu oturumda yenilemediyse: bir kez yenile (eski SW/önbelleği atla).
      if (!sessionStorage.getItem(RELOAD_KEY)) {
        sessionStorage.setItem(RELOAD_KEY, '1')
        window.location.reload()
        // reload asenkron; Suspense'i askıda tut (çözülmeyen promise).
        return new Promise<{ default: T }>(() => {})
      }
      // İkinci kez de başarısız → hatayı ErrorBoundary'e bırak.
      throw err
    }
  })
}
