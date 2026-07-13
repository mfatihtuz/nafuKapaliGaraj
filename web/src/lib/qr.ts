// QR üretimi (client-side, qrcode npm). QR'da SADECE konum URL'i (CLAUDE.md §6).

import QRCode from 'qrcode'

/** Konum kodu → tam QR URL'i. tenants.settings.qr_base_url varsa onu kullan. */
export function locationUrl(code: string, qrBaseUrl?: string | null): string {
  if (qrBaseUrl && qrBaseUrl.trim() !== '') {
    return qrBaseUrl.replace(/\/+$/, '') + '/' + encodeURIComponent(code)
  }
  // Varsayılan: mevcut origin + uygulama tabanı + /l/<code>
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '')
  return `${window.location.origin}${base}/l/${encodeURIComponent(code)}`
}

export async function qrDataUrl(text: string, size = 256): Promise<string> {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#14213d', light: '#ffffff' },
  })
}

/** Etiket basımı için SVG (ölçeklenebilir, keskin). */
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    margin: 0,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  })
}
