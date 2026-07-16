// UUIDv7 — istemci tarafı üretim (SYNC_PROTOCOL §3).
// Zaman-sıralı; offline'da ID beklemeden yeni kayıt oluşturmayı sağlar.

export function uuidv7(): string {
  const ts = Date.now() // 48-bit ms
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)

  // İlk 48 bit: zaman damgası (big-endian)
  bytes[0] = (ts / 2 ** 40) & 0xff
  bytes[1] = (ts / 2 ** 32) & 0xff
  bytes[2] = (ts / 2 ** 24) & 0xff
  bytes[3] = (ts / 2 ** 16) & 0xff
  bytes[4] = (ts / 2 ** 8) & 0xff
  bytes[5] = ts & 0xff
  // Sürüm 7
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  // Varyant 10xx
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex: string[] = []
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'))
  const s = hex.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}

/**
 * Bir tohumdan DETERMİNİSTİK, v7-biçimli UUID üretir (SHA-256). Aynı tohum → aynı id.
 * Kullanım: "son hareketi geri al" telafi kaydının id'si = tohum('undo:'+kaynakTxId).
 * Böylece aynı geri-alma iki kez uygulanamaz: yerelde applyTx id ile teklenir, sunucuda
 * tekrar INSERT PK çakışır → reddedilir (asla çift uygulanmaz → negatif stok olmaz).
 * crypto.subtle yoksa (güvensiz bağlam) rastgele uuidv7'ye düşer (idempotentlik kaybolur
 * ama in-flight kilidi tek-cihaz çift-dokunuşu zaten önler).
 */
export async function deterministicUuid(seed: string): Promise<string> {
  if (!globalThis.crypto?.subtle) return uuidv7()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed))
  const b = new Uint8Array(digest).slice(0, 16)
  b[6] = (b[6] & 0x0f) | 0x70 // sürüm 7 biçimi
  b[8] = (b[8] & 0x3f) | 0x80 // varyant 10xx
  const hex: string[] = []
  for (let i = 0; i < 16; i++) hex.push(b[i].toString(16).padStart(2, '0'))
  const s = hex.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}

const V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuidv7(id: string): boolean {
  return V7_RE.test(id)
}
