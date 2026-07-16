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
  opts: { multiFormat?: boolean } = {},
): Promise<ScannerHandle> {
  // multiFormat: ürün barkodları (EAN/UPC/Code128/DataMatrix…) da okunur — parça girişi
  // için (poşet barkodu). Konum taramada YALNIZCA QR (konum etiketleri QR'dır).
  const mod = await import('@zxing/browser')
  const reader = opts.multiFormat ? new mod.BrowserMultiFormatReader() : new mod.BrowserQRCodeReader()
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
