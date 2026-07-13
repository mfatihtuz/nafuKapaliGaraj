// Türkçe karakter duyarsız arama/normalizasyon (CLAUDE.md §5).
// 'direnc' → 'Direnç' bulur.

const LOWER_MAP: Record<string, string> = {
  ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', I: 'i', İ: 'i',
  ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u',
}

const ASCII_MAP: Record<string, string> = {
  ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I',
  ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U',
}

const COMBINING = /[̀-ͯ]/g

/** Arama için: Türkçe→ASCII + aksan kaldır + küçük harf. */
export function normalize(s: string): string {
  let out = ''
  for (const ch of s) out += LOWER_MAP[ch] ?? ch
  return out.normalize('NFD').replace(COMBINING, '').toLowerCase().trim()
}

/** SKU için: Türkçe→ASCII, harf büyüklüğü korunur. */
export function foldToAscii(s: string): string {
  let out = ''
  for (const ch of s) out += ASCII_MAP[ch] ?? ch
  return out.normalize('NFD').replace(COMBINING, '')
}

/**
 * Çok terimli arama: sorgudaki her kelime, hedef metinlerin birleşiminde geçmeli.
 */
export function searchMatch(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = normalize(query)
  if (q === '') return true
  const haystack = fields.map((f) => normalize(f ?? '')).join(' ')
  return q.split(/\s+/).every((term) => haystack.includes(term))
}
