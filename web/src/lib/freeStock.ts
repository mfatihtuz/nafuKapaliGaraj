// "Serbest stok" kanonik tanımı (FAZ 3a). TEK KAYNAK — feasibility ("yapabilir miyim?"),
// arama ve envanter toplamları BURADAN geçmeli; aksi hâlde stok sayıları sessizce yanlışlanır.
//
// Serbest = başka bir işe AYRILMAMIŞ stok. Proje gözü (projeye çekilmiş), ödünç (birine
// verilmiş) ve karantina (kullanılamaz) konumları "elde"den DIŞLANIR. Tezgah/çekmece/giriş
// serbest sayılır (kullanıcı kararı: tezgah serbest).

import type { LocationType } from '../db/types'

const RESERVED_TYPES: ReadonlySet<LocationType> = new Set<LocationType>(['project', 'loan', 'quarantine'])

/** Bu konum türündeki stok "serbest" (elde) mi sayılır? */
export function isFreeStockType(type: LocationType | null | undefined): boolean {
  return type != null && !RESERVED_TYPES.has(type)
}

/** Bir konumun (varsa) stoğu serbest mi. Konum bilinmiyorsa güvenli varsayılan: serbest DEĞİL. */
export function isFreeStock(loc: { type: LocationType } | null | undefined): boolean {
  return loc != null && isFreeStockType(loc.type)
}
