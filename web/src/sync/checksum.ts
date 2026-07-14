// Stok self-heal (SYNC_PROTOCOL §5.6). İstemci yerel stok özetini sunucununkiyle
// karşılaştırır; ayrışma (sessiz kayma) varsa yeniden bootstrap ederek hizalanır.
//
// Kanonik satır: "part_id:location_id:qtyMilli:level" — tümü ASCII. Sıralama JS
// varsayılan (code-unit) → sunucudaki PHP SORT_STRING (bayt) ile BİREBİR aynı.
// Algoritma SyncService::stockChecksum ile eşleşmeli; aksi hâlde sonsuz re-heal olur.

import { db } from '../db/dexie'

/** Bir stok satırının kanonik temsili — sunucu ile birebir. */
function line(partId: string, locationId: string, qty: number, level: string | null): string {
  const qtyMilli = Math.round(qty * 1000)
  return `${partId}:${locationId}:${qtyMilli}:${level ?? ''}`
}

/** SHA-256 hex. Güvenli bağlam gerektirir (https / localhost) — yoksa null. */
async function sha256Hex(input: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null
  const bytes = new TextEncoder().encode(input)
  const digest = await subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Yerel stok tablosunun SHA-256 özeti. crypto.subtle yoksa null döner
 * (self-heal atlanır — asla yanlış pozitif re-bootstrap üretme).
 */
export async function localStockChecksum(): Promise<{ checksum: string; rows: number } | null> {
  const all = await db.stock.toArray()
  const lines = all.map((s) => line(s.part_id, s.location_id, Number(s.qty), s.level))
  lines.sort() // code-unit sırası — PHP sort(SORT_STRING) ile aynı (ASCII)
  const checksum = await sha256Hex(lines.join('\n'))
  return checksum === null ? null : { checksum, rows: all.length }
}
