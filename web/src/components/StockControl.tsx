import { useState } from 'react'
import type { Part, Stock, StockLevel } from '../db/types'
import { moveStock, setLevel } from '../db/actions'
import { formatQty, LEVEL_LABEL } from '../lib/format'
import { useT } from '../i18n'
import { useAuth } from '../auth/AuthContext'
import { IconPlus, IconMinus } from './icons'

interface Props {
  part: Part
  stock?: Stock
  locationId: string
}

const LEVELS: StockLevel[] = ['full', 'low', 'empty']

/** Misafir (viewer) için salt-okunur stok görünümü — düğme yok. */
function StockReadonly({ part, stock }: { part: Part; stock?: Stock }) {
  const { t } = useT()
  if (part.count_mode === 'unmanaged') {
    return <span className="chip bg-brand-50 text-brand-500">{t('count_mode.unmanaged')}</span>
  }
  if (part.count_mode === 'level') {
    const lvl = stock?.level ?? null
    if (!lvl) return <span className="chip bg-brand-50 text-brand-400">{t('level.unknown')}</span>
    const cls = lvl === 'full' ? 'chip-full' : lvl === 'low' ? 'chip-low' : 'chip-empty'
    return <span className={cls}>{LEVEL_LABEL[lvl]}</span>
  }
  const qty = stock?.qty ?? 0
  const low = part.min_qty != null && qty < part.min_qty
  return (
    <span className={`chip tabular-nums ${low ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-brand-600'}`}>
      {formatQty(qty, part.unit)}
    </span>
  )
}

/** exact / level / unmanaged sayım modlarına göre stok kontrolü (PRD §5.2). Optimistik. */
export function StockControl({ part, stock, locationId }: Props) {
  const { t } = useT()
  const { canWrite } = useAuth()
  const [showN, setShowN] = useState(false)
  const [nVal, setNVal] = useState('')

  // Misafir yalnızca görüntüler — hiçbir stok hareketi yapamaz.
  if (!canWrite) return <StockReadonly part={part} stock={stock} />

  if (part.count_mode === 'unmanaged') {
    return <span className="chip bg-brand-50 text-brand-500">{t('count_mode.unmanaged')}</span>
  }

  if (part.count_mode === 'level') {
    const current = stock?.level ?? null
    return (
      <div className="flex gap-1.5">
        {LEVELS.map((lvl) => {
          const active = current === lvl
          const tone =
            lvl === 'full' ? 'bg-green-600' : lvl === 'low' ? 'bg-amber-500' : 'bg-red-600'
          return (
            <button
              key={lvl}
              onClick={() => void setLevel(part.id, locationId, lvl)}
              className={`btn min-h-touch flex-1 px-2 text-sm font-bold ${
                active ? `${tone} text-white` : 'bg-white text-brand-500 border border-mist'
              }`}
            >
              {LEVEL_LABEL[lvl]}
            </button>
          )
        })}
      </div>
    )
  }

  // exact
  const qty = stock?.qty ?? 0
  const low = part.min_qty != null && qty < part.min_qty
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => void moveStock({ partId: part.id, locationId, delta: -1, reason: 'consume' })}
          disabled={qty <= 0}
          className="btn-navy min-h-touch min-w-touch text-xl disabled:opacity-40"
          aria-label="−1"
        >
          <IconMinus />
        </button>
        <div className="min-w-[4.5rem] text-center">
          <div className={`text-2xl font-extrabold tabular-nums ${low ? 'text-red-600' : 'text-brand-800'}`}>
            {qty}
          </div>
          <div className="text-[11px] text-brand-400">{part.unit}</div>
        </div>
        <button
          onClick={() => void moveStock({ partId: part.id, locationId, delta: 1, reason: 'adjust' })}
          className="btn-primary min-h-touch min-w-touch text-xl"
          aria-label="+1"
        >
          <IconPlus />
        </button>
      </div>

      {showN ? (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            type="number"
            inputMode="numeric"
            value={nVal}
            onChange={(e) => setNVal(e.target.value)}
            placeholder="N"
            className="input h-10 w-20 px-2 text-center"
          />
          <button
            className="btn-danger h-10 px-3 text-sm"
            onClick={() => {
              // Eldeki miktardan fazlası düşülemez — stok sessizce negatife inmesin
              // (negatif satır 'tükenmiş' sayılıp listeden kaybolur, kullanıcı şaşırır).
              const n = Math.min(Math.abs(Number(nVal)), qty)
              if (n > 0) void moveStock({ partId: part.id, locationId, delta: -n, reason: 'consume' })
              setNVal('')
              setShowN(false)
            }}
          >
            −N
          </button>
          <button className="btn-ghost h-10 px-3 text-sm" onClick={() => setShowN(false)}>
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <button className="text-xs font-medium text-brand-400 underline" onClick={() => setShowN(true)}>
          {formatQty(qty, part.unit)} · −N
        </button>
      )}
    </div>
  )
}
