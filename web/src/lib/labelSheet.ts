// A4 etiket sayfası hesabı. Sütun/satır artık ELLE girilmez — etiketin fiziksel
// ölçüsünden (En×Boy) ve A4 basılabilir alanından TÜRETİLİR. Böylece hem tekrar
// önlenir hem de çıktı A4'e gerçek boyutunda ve taşmadan dizilir.

export const A4 = { w_mm: 210, h_mm: 297 }
/** Yazıcıların basamadığı dış kenar payı (her kenar). */
export const SHEET_MARGIN_MM = 6
/** Etiketler arası boşluk. */
export const LABEL_GAP_MM = 1

/** Verilen etiket ölçüsü için A4'e sığan sütun/satır sayısı. */
export function computeGrid(w_mm: number, h_mm: number): { cols: number; rows: number } {
  const w = Number(w_mm), h = Number(h_mm)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { cols: 1, rows: 1 }
  }
  const usableW = A4.w_mm - 2 * SHEET_MARGIN_MM
  const usableH = A4.h_mm - 2 * SHEET_MARGIN_MM
  // N adet s uzunluğunda öğe, g boşlukla L uzunluğa sığar: floor((L+g)/(s+g))
  const cols = Math.max(1, Math.floor((usableW + LABEL_GAP_MM) / (w + LABEL_GAP_MM)))
  const rows = Math.max(1, Math.floor((usableH + LABEL_GAP_MM) / (h + LABEL_GAP_MM)))
  return { cols, rows }
}

/** Bir A4 sayfaya sığan toplam etiket sayısı. */
export function perPage(w_mm: number, h_mm: number): number {
  const { cols, rows } = computeGrid(w_mm, h_mm)
  return cols * rows
}
