// Varsayılan etiket tipleri — fiziksel çekmece tiplerine göre.
// Kiracının ayarlarında `label_types` yoksa (yeni kurulum / eksik seed) bunlar
// başlangıç önerisi olarak gösterilir; kullanıcı düzenleyip "Kaydet" ile kalıcılaştırır.
// Ölçüler: bir etiketin fiziksel eni/boyu (mm), sayfadaki sütun/satır sayısı, eldeki adet.

import type { LabelType } from '../db/types'

// Not: cols/rows artık En×Boy'dan A4'e göre TÜRETİLİR (bkz. labelSheet.computeGrid);
// buradaki değerler yalnızca başlangıç yer tutucusudur, gösterim/kayıt sırasında yeniden hesaplanır.
export const DEFAULT_LABEL_TYPES: LabelType[] = [
  { id: 'lt-s1', name: 'S1 · 70’lik göz (küçük)',  w_mm: 30, h_mm: 12, cols: 6, rows: 22, qty: 70 },
  { id: 'lt-s2', name: 'S2/S3 · modüler çekmece',  w_mm: 38, h_mm: 21, cols: 5, rows: 13, qty: 42 },
  { id: 'lt-a1', name: 'A1 · büyük çekmece',        w_mm: 50, h_mm: 30, cols: 3, rows: 9,  qty: 16 },
  { id: 'lt-a2', name: 'A2 · 3D küçük çekmece',     w_mm: 38, h_mm: 21, cols: 5, rows: 13, qty: 40 },
  { id: 'lt-b1', name: 'B1 · dar hazne',            w_mm: 40, h_mm: 15, cols: 4, rows: 17, qty: 40 },
  { id: 'lt-c1', name: 'C1 · kule çekmecesi',       w_mm: 50, h_mm: 30, cols: 3, rows: 9,  qty: 9  },
]

export const DEFAULT_LABEL_GRID = { w_mm: 38, h_mm: 21, cols: 5, rows: 13 }
