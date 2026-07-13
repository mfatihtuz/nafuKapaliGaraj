import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AppHeader, Container } from '../components/Layout'
import { useSearch, type SearchHit } from '../db/queries'
import type { Part, Stock } from '../db/types'
import { LEVEL_LABEL, formatQty } from '../lib/format'
import { useT } from '../i18n'
import { IconSearch } from '../components/icons'

function StockPill({ part, stock }: { part: Part; stock: Stock }) {
  if (part.count_mode === 'level') {
    const lvl = stock.level
    if (!lvl) return null
    const cls = lvl === 'full' ? 'chip-full' : lvl === 'low' ? 'chip-low' : 'chip-empty'
    return <span className={cls}>{LEVEL_LABEL[lvl]}</span>
  }
  if (part.count_mode === 'exact') {
    return <span className="chip bg-brand-50 text-brand-600 tabular-nums">{formatQty(stock.qty, part.unit)}</span>
  }
  return null
}

function ResultCard({ hit }: { hit: SearchHit }) {
  const { t } = useT()
  const { part, places } = hit
  const attrs = part.attributes ? Object.values(part.attributes).filter(Boolean).join(' · ') : ''
  return (
    <div className="card p-3">
      <Link to={`/parts/${part.id}`} className="block">
        <div className="font-semibold text-brand-800">{part.name}</div>
        <div className="text-xs text-brand-400">
          <span className="font-mono">{part.sku}</span>
          {attrs && <span> — {attrs}</span>}
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

export function Search() {
  const { t } = useT()
  const [query, setQuery] = useState('')
  const [showQt, setShowQt] = useState(false)
  const hits = useSearch(query, showQt)

  return (
    <>
      <AppHeader />
      <Container>
        <div className="sticky top-16 z-10 -mx-3 mb-3 bg-mist px-3 pb-2 pt-1">
          <div className="relative">
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
          <label className="mt-2 flex items-center gap-2 text-xs text-brand-400">
            <input type="checkbox" checked={showQt} onChange={(e) => setShowQt(e.target.checked)} />
            {t('search.show_quarantine')}
          </label>
        </div>

        {query.trim() !== '' && (
          <div className="mb-2 text-xs text-brand-400">{t('search.count', { n: hits.length })}</div>
        )}

        <div className="flex flex-col gap-2">
          {query.trim() !== '' && hits.length === 0 ? (
            <p className="py-12 text-center text-brand-400">{t('search.no_results')}</p>
          ) : (
            hits.map((hit) => <ResultCard key={hit.part.id} hit={hit} />)
          )}
        </div>
      </Container>
    </>
  )
}
