// QR tarama — @zxing/browser (iOS Safari BarcodeDetector desteklemiyor, CLAUDE.md §2).
//
// @zxing/browser ~410 KB'dır. STATİK import edilirse /scan (açılış ekranı) her
// açılışta bu yükü çeker; yeni dağıtım sonrası bu chunk takılırsa uygulama "Tara"
// ekranında donar. Bu yüzden ZXing yalnızca kullanıcı "Kamerayı aç"a basınca
// DİNAMİK yüklenir — açılış ekranı hafif ve dayanıklı kalır.

import type { IScannerControls } from '@zxing/browser'

export interface ScannerHandle {
  stop: () => void
}

/**
 * Arka kamerayı tercih ederek QR taramayı başlatır.
 * Her okumada onCode(text) çağrılır. Durdurmak için handle.stop().
 * ZXing yalnızca burada (kamera açılırken) yüklenir.
 */
export async function startScanner(
  video: HTMLVideoElement,
  onCode: (text: string) => void,
): Promise<ScannerHandle> {
  const { BrowserQRCodeReader } = await import('@zxing/browser')
  const reader = new BrowserQRCodeReader()
  let controls: IScannerControls | null = null

  controls = await reader.decodeFromConstraints(
    { video: { facingMode: { ideal: 'environment' } } },
    video,
    (result) => {
      if (result) onCode(result.getText())
    },
  )

  return {
    stop: () => {
      try {
        controls?.stop()
      } catch {
        /* yoksay */
      }
    },
  }
}

/** Taranan metinden konum kodunu çıkarır. QR ya düz kod ya da .../l/<kod> URL'i olabilir. */
export function extractLocationCode(scanned: string): string {
  const s = scanned.trim()
  const m = s.match(/\/l\/([^/?#]+)/i)
  if (m) return decodeURIComponent(m[1]).toUpperCase()
  // Düz kod (S1-07 gibi)
  return s.toUpperCase()
}
