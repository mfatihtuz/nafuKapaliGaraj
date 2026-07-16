// İstemci-tarafı görsel küçültme + sha256 — YENİ BAĞIMLILIK YOK (canvas + crypto.subtle).
// Foto yüklemeden önce ~1600px JPEG'e indirgenir: mobil yükleme çok daha hızlı,
// sunucu yükü azalır. sha256 = küçültülmüş baytın özeti → sunucuyla aynı dedup anahtarı.

export interface ProcessedImage { blob: Blob; width: number; height: number }

/** Görsel Blob'unu en uzun kenarı maxEdge olacak şekilde JPEG'e küçültür (EXIF yönü uygulanır). */
export async function downscaleImage(file: Blob, maxEdge = 1600, quality = 0.82): Promise<ProcessedImage> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // Bazı tarayıcılar imageOrientation seçeneğini desteklemez — düz dene.
    bitmap = await createImageBitmap(file)
  }
  const w = bitmap.width
  const h = bitmap.height
  const scale = Math.min(1, maxEdge / Math.max(1, Math.max(w, h)))
  const nw = Math.max(1, Math.round(w * scale))
  const nh = Math.max(1, Math.round(h * scale))
  const canvas = document.createElement('canvas')
  canvas.width = nw
  canvas.height = nh
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d bağlamı yok')
  ctx.drawImage(bitmap, 0, 0, nw, nh)
  bitmap.close?.()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('görsel kodlanamadı')
  return { blob, width: nw, height: nh }
}

/** Blob'un SHA-256 hex özeti (bayt-dedup anahtarı; sunucudaki hash ile aynı). */
export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Blob → base64 (AI görsel gönderimi için; data: öneki olmadan). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}
