// Bağımlılıksız CSV ayrıştırıcı (CLAUDE.md §2: sıfır ekstra bağımlılık hedefi).
// Türkçe Excel gerçekleri: ayraç genelde ';' (virgül ondalık kullanıldığından), BOM
// başta gelir, satır sonu CRLF olur. Tırnaklı alanlar gömülü ayraç/tırnak/yeni satır taşır.

/** Başlık satırından ayracı sez: ';' , ',' veya sekme — hangisi daha çoksa. */
export function detectDelimiter(firstLine: string): string {
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 }
  let inQ = false
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ
    else if (!inQ && ch in counts) counts[ch]++
  }
  let best = ',', max = -1
  for (const d of [';', ',', '\t']) {
    if (counts[d] > max) { max = counts[d]; best = d }
  }
  return best
}

/**
 * CSV metnini satır×hücre dizisine çevirir. Tırnak kaçışı ("" → "), CRLF/LF,
 * gömülü yeni satır desteklenir. BOM atılır. Ayraç verilmezse ilk satırdan sezilir.
 * Tümüyle boş satırlar düşürülür.
 */
export function parseCsv(text: string, delimiter?: string): string[][] {
  let src = text
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1) // BOM
  const firstNl = src.search(/\r?\n/)
  const headerLine = firstNl === -1 ? src : src.slice(0, firstNl)
  const delim = delimiter ?? detectDelimiter(headerLine)

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQ = false
  let i = 0
  const n = src.length
  const pushField = () => { row.push(field); field = '' }
  const pushRow = () => {
    pushField()
    if (row.some((c) => c !== '')) rows.push(row) // tümüyle boş satırı atla
    row = []
  }
  while (i < n) {
    const ch = src[i]
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue }
        inQ = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"') { inQ = true; i++; continue }
    if (ch === delim) { pushField(); i++; continue }
    if (ch === '\r') { i++; continue }
    if (ch === '\n') { pushRow(); i++; continue }
    field += ch; i++
  }
  // Son alan/satır
  if (field !== '' || row.length > 0) pushRow()
  return rows
}

/** Bir hücre dizisini RFC-4180 uyumlu CSV satırına çevirir (şablon üretimi için). */
export function toCsvRow(cells: (string | number)[], delimiter = ';'): string {
  return cells
    .map((c) => {
      const s = String(c)
      return /["\n\r]|[;,\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    })
    .join(delimiter)
}
