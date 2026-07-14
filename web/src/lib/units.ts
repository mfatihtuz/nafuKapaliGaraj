// Miktarlı (exact) parçalar için birimler. Kablo=metre, sıvı=litre, vb.
export const UNITS = [
  'adet', 'metre', 'cm', 'mm', 'm²',
  'gram', 'kg', 'litre', 'ml',
  'paket', 'rulo', 'çift', 'takım', 'top',
] as const

export type Unit = (typeof UNITS)[number]
