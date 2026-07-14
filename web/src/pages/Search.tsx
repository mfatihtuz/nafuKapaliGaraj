import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppHeader, Container } from '../components/Layout'
import { useSearch, useCategories, useLocations, type SearchHit } from '../db/queries'
import type { Category, Location, Part, Stock } from '../db/types'
import { levelLabel, unitLabel, formatQty } from '../lib/format'
import { useT } from '../i18n'
import { IconSearch } from '../components/icons'

function StockPill({ part, stock }: { part: Part; stock: Stock }) {
  const { t } = useT()
  if (part.count_mode === 'level') {
    const lvl = stock.level
    if (!lvl) return null
    const cls = lvl === 'full' ? 'chip-full' : lvl === 'low' ? 'chip-low' : 'chip-empty'
    return <span className={cls}>{levelLabel(t, lvl)}</span>
  }
  if (part.count_mode === 'exact') {
    return <span className="chip bg-brand-50 text-brand-600 tabular-nums">{formatQty(stock.qty, unitLabel(t, part.unit))}</span>
  }
  return null
}

function ResultCard({ hit }: { hit: SearchHit }) {
  const { t } = useT()
  const { part, places, categoryName } = hit
  return (
    <div className="card card-pad">
      <Link to={`/parts/${part.id}`} className="block">
        <div className="flex items-start justify-between gap-2">
          <div className="font-semibold text-brand-800">{part.name}</div>
          {/* Kategori (grup) belirgin: gri satır yerine chip */}
          {categoryName && (
            <span className="chip shrink-0 bg-brand-50 px-2 py-0.5 text-[11px] text-brand-500">{categoryName}</span>
          )}
        </div>
        <div className="text-xs text-brand-400">
          <span className="font-mono">{part.sku}</span>
        </div>
      </Link>

      <div className="mt-2 flex flex-col gap-1.5">
        {places.length === 0 ? (
          <span className="text-sm text-brand-300">{t('search.no_location')}</span>
        ) : (
          places.map(({ stock, location }) => (
            <div key={location.id} className="flex items-center justify-between gap-2">
              <Link to={`/l/${encodeURIComponent(location.code)}`} className="loc-code text-2xl">
                {location.code}
              </Link>
              <StockPill part={part} stock={stock} />
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/** Kategorileri girintili düz listeye çevir (dropdown için). */
function flattenCategories(categories: Category[]): { id: string; label: string }[] {
  const byParent = new Map<string | null, Category[]>()
  for (const c of categories) {
    const k = c.parent_id ?? null
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k)!.push(c)
  }
  const out: { id: string; label: string }[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const c of (byParent.get(parent) ?? []).sort((a, b) => a.sort_order - b.sort_order)) {
      out.push({ id: c.id, label: `${'  '.repeat(depth)}${c.name_tr}` })
      walk(c.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/** Konumları girintili düz listeye çevir — dolap seçilince altındaki her şey aranır. */
function flattenLocations(locations: Location[]): { id: string; label: string }[] {
  const byParent = new Map<string | null, Location[]>()
  for (const l of locations) {
    const k = l.parent_id ?? null
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k)!.push(l)
  }
  const out: { id: string; label: string }[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const l of (byParent.get(parent) ?? []).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))) {
      out.push({ id: l.id, label: `${'  '.repeat(depth)}${l.code}${l.name ? ` — ${l.name}` : ''}` })
      walk(l.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

export function Search() {
  const { t } = useT()
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [showQt, setShowQt] = useState(false)
  const categories = useCategories()
  const locations = useLocations()
  const catOptions = useMemo(() => flattenCategories(categories), [categories])
  const locOptions = useMemo(() => flattenLocations(locations), [locations])
  const hits = useSearch(query, categoryId, showQt, locationId)

  return (
    <>
      <AppHeader title={t('nav.search')} />
      <Container>
        <div className="sticky top-14 z-10 -mx-4 mb-3 border-b border-line bg-canvas/95 px-4 pb-3 pt-2 backdrop-blur">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="select sm:w-48"
              aria-label={t('common.category')}
            >
              <option value="">{t('search.all_categories')}</option>
              {catOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            {/* Konum filtresi: dolap seçilince altındaki TÜM çekmeceler aranır */}
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="select sm:w-48"
              aria-label={t('common.location')}
            >
              <option value="">{t('search.all_locations')}</option>
              {locOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <div className="relative flex-1">
              <IconSearch size={20} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-300" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('common.search_placeholder')}
                className="input pl-10"
                enterKeyHint="search"
              />
            </div>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-brand-400">
            <input type="checkbox" checked={showQt} onChange={(e) => setShowQt(e.target.checked)} />
            {t('search.show_quarantine')}
          </label>
        </div>

        <div className="mb-2 text-xs text-brand-400">{t('search.count', { n: hits.length })}</div>

        <div className="flex flex-col gap-2">
          {hits.length === 0 ? (
            <p className="py-12 text-center text-brand-400">
              {query || categoryId || locationId ? t('search.no_results') : t('search.empty_inventory')}
            </p>
          ) : (
            hits.map((hit) => <ResultCard key={hit.part.id} hit={hit} />)
          )}
        </div>
      </Container>
    </>
  )
}
