// Konum seçici — ham <datalist> yerine gruplu, akıllı combobox.
//   • Öneriler DOLAP başlıkları altında gruplanır (grup/alt-grup belirgin).
//   • Yalnızca YAPRAK konumlar (gerçek çekmece/göz) seçilebilir.
//   • Yazarken eşleşen öneri varken "böyle konum yok" hatası BASILMAZ;
//     hata yalnızca hiçbir önerinin kalmadığı durumda görünür.
//   • Dolap/grup kodu tam yazılırsa açıklayıcı amber uyarı gösterir.

import { useMemo, useRef, useState } from 'react'
import type { Location } from '../db/types'
import { normalize } from '../lib/normalize'
import { useT } from '../i18n'
import { IconCheck } from './icons'

export interface LocationPickerProps {
  value: string
  onChange: (code: string) => void
  locations: Location[]
  id?: string
  autoFocus?: boolean
}

interface Group { key: string; title: string; items: Location[] }

/** Yaprak konumlar (altında başka konum olmayanlar) — depolama hedefleri. */
export function leafLocations(locations: Location[]): Location[] {
  const parents = new Set(locations.filter((l) => l.parent_id).map((l) => l.parent_id as string))
  return locations.filter((l) => !parents.has(l.id))
}

/** value tam bir yaprak koda eşitse o konumu döndürür (Intake/Taşı bunun üstünden kaydeder). */
export function resolveLeaf(value: string, locations: Location[]): Location | undefined {
  const code = value.trim().toUpperCase()
  const hit = locations.find((l) => l.code.toUpperCase() === code)
  if (!hit) return undefined
  const parents = new Set(locations.filter((l) => l.parent_id).map((l) => l.parent_id as string))
  return parents.has(hit.id) ? undefined : hit
}

export function LocationPicker({ value, onChange, locations, id, autoFocus }: LocationPickerProps) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const leaves = useMemo(() => leafLocations(locations), [locations])
  const byId = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])

  // En üst ata = dolap başlığı. Kök yapraklar "diğer" grubuna gider.
  const rootOf = (l: Location): Location => {
    let cur = l
    for (let guard = 0; guard < 10; guard++) {
      const p = cur.parent_id ? byId.get(cur.parent_id) : undefined
      if (!p) return cur
      cur = p
    }
    return cur
  }

  const q = normalize(value.trim())
  const matches = useMemo(() => {
    const list = q === ''
      ? leaves
      : leaves.filter((l) => normalize(l.code).includes(q) || normalize(l.path).includes(q) || normalize(l.name ?? '').includes(q))
    return list.slice(0, 60)
  }, [leaves, q])

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>()
    for (const l of matches) {
      const root = rootOf(l)
      const key = root.id === l.id ? '_root' : root.id
      const title = root.id === l.id
        ? t('picker.ungrouped')
        : `${root.code}${root.name ? ` — ${root.name}` : ''}`
      if (!map.has(key)) map.set(key, { key, title, items: [] })
      map.get(key)!.items.push(l)
    }
    for (const g of map.values()) {
      g.items.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    }
    return [...map.values()].sort((a, b) => a.title.localeCompare(b.title, 'tr'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches])

  // Durum: tam yaprak eşleşme / grup kodu / hiç öneri yok
  const typed = value.trim().toUpperCase()
  const exact = locations.find((l) => l.code.toUpperCase() === typed)
  const leafMatch = exact && leaves.some((l) => l.id === exact.id) ? exact : undefined
  const groupMatch = exact && !leafMatch ? exact : undefined

  function pick(l: Location) {
    onChange(l.code)
    setOpen(false)
  }

  return (
    <div className="relative">
      <input
        id={id}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 150) }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
          if (e.key === 'Enter' && !leafMatch && matches.length > 0) {
            e.preventDefault()
            pick(matches[0])
          }
        }}
        placeholder={t('intake.location_placeholder')}
        className={`input pr-9 font-mono uppercase ${leafMatch ? 'border-green-500' : ''}`}
        autoCapitalize="characters"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
      />
      {leafMatch && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-green-600">
          <IconCheck size={18} />
        </span>
      )}

      {/* Öneri paneli — dolap başlıklarıyla gruplu */}
      {open && !leafMatch && groups.length > 0 && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-white shadow-lg">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="sticky top-0 border-b border-mist bg-brand-50/95 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-500 backdrop-blur">
                {g.title}
              </div>
              {g.items.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  data-loc-option={l.code}
                  onMouseDown={(e) => { e.preventDefault(); pick(l) }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-accent/10"
                >
                  <span className="loc-code text-base">{l.code}</span>
                  <span className="truncate text-xs text-brand-400">{l.name ?? l.path}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Durum mesajları: yazmayı bitirmeden hata gösterme */}
      {leafMatch && <p className="field-hint text-green-700">{leafMatch.path}</p>}
      {!leafMatch && groupMatch && (
        <p className="field-hint text-amber-600">{t('intake.location_is_group', { code: groupMatch.code })}</p>
      )}
      {!leafMatch && !groupMatch && typed !== '' && matches.length === 0 && (
        <p className="field-hint text-red-600">{t('scan.not_found', { code: value })}</p>
      )}
    </div>
  )
}
