import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AppHeader, Container } from '../components/Layout'
import {
  usePart, useCategory, useLocationsForPart, useTransactionsForPart,
} from '../db/queries'
import type { CountMode, Part } from '../db/types'
import { savePart, softDeletePart } from '../db/actions'
import { LEVEL_LABEL, REASON_LABEL, timeAgo } from '../lib/format'
import { UNITS } from '../lib/units'
import { StockControl } from '../components/StockControl'
import { useT } from '../i18n'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { IconEdit, IconTrash, IconCheck } from '../components/icons'

const MODES: CountMode[] = ['exact', 'level', 'unmanaged']

export function PartDetail() {
  const { id = '' } = useParams()
  const { t } = useT()
  const { canWrite } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const part = usePart(id)
  const category = useCategory(part?.category_id)
  const places = useLocationsForPart(id)
  const history = useTransactionsForPart(id)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Part | null>(null)

  if (part === undefined) {
    return (
      <>
        <AppHeader back />
        <Container><p className="py-16 text-center text-brand-400">{t('common.loading')}</p></Container>
      </>
    )
  }
  if (!part) {
    return (
      <>
        <AppHeader back />
        <Container><p className="py-16 text-center text-brand-400">{t('search.no_results')}</p></Container>
      </>
    )
  }

  const current = editing && draft ? draft : part

  function startEdit() {
    setDraft({ ...part! })
    setEditing(true)
  }
  async function save() {
    if (!draft) return
    await savePart(draft)
    setEditing(false)
    setDraft(null)
    toast.show(t('common.save'), 'success')
  }
  async function remove() {
    if (!confirm(t('part.delete_confirm'))) return
    await softDeletePart(part!.id)
    toast.show(t('common.delete'), 'success')
    navigate(-1)
  }

  const schema = category?.attribute_schema ?? null

  return (
    <>
      <AppHeader
        back
        right={
          !canWrite ? null : editing ? (
            <button onClick={() => void save()} className="btn-primary h-9 px-3 text-sm">
              <IconCheck size={16} /> {t('common.save')}
            </button>
          ) : (
            <button onClick={startEdit} className="btn-icon h-9 w-9 text-white/90 hover:bg-white/10">
              <IconEdit size={18} />
            </button>
          )
        }
      />
      <Container>
        {/* Başlık */}
        <div className="card mb-3 p-4">
          {editing ? (
            <input
              className="input mb-2 text-lg font-bold"
              value={current.name}
              onChange={(e) => setDraft({ ...current, name: e.target.value })}
            />
          ) : (
            <h1 className="text-xl font-bold text-brand-800">{part.name}</h1>
          )}
          <div className="font-mono text-sm text-brand-400">{part.sku}</div>
          {(part.mpn || part.manufacturer) && (
            <div className="mt-1 text-xs text-brand-400">
              {[part.manufacturer, part.mpn].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>

        {/* Sayım modu + min stok */}
        <div className="card mb-3 p-4">
          <div className="field-label">{t('part.count_mode')}</div>
          <div className="mb-3 flex gap-1.5">
            {MODES.map((m) => {
              const active = current.count_mode === m
              return (
                <button
                  key={m}
                  disabled={!editing}
                  onClick={() => setDraft({ ...current, count_mode: m })}
                  className={`btn flex-1 px-2 text-xs ${
                    active ? 'bg-brand text-white' : 'bg-brand-50 text-brand-500'
                  } ${editing ? '' : 'cursor-default opacity-90'}`}
                >
                  {t(`count_mode.${m}`)}
                </button>
              )
            })}
          </div>
          {current.count_mode === 'exact' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label" htmlFor="unit">{t('intake.unit')}</label>
                <select
                  id="unit" disabled={!editing} className="select disabled:bg-brand-50"
                  value={current.unit}
                  onChange={(e) => setDraft({ ...current, unit: e.target.value })}
                >
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  {!UNITS.includes(current.unit as never) && <option value={current.unit}>{current.unit}</option>}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="minq">{t('part.min_qty')}</label>
                <input
                  id="minq" type="number" inputMode="decimal" disabled={!editing}
                  className="input disabled:bg-brand-50"
                  value={current.min_qty ?? ''}
                  onChange={(e) =>
                    setDraft({ ...current, min_qty: e.target.value === '' ? null : Number(e.target.value) })
                  }
                />
              </div>
            </div>
          )}
        </div>

        {/* Öznitelikler */}
        {part.attributes && Object.keys(part.attributes).length > 0 && (
          <div className="card mb-3 p-4">
            <div className="field-label">{t('part.attributes')}</div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {(schema ?? []).map((def) => {
                const v = part.attributes?.[def.key]
                if (v === null || v === undefined || v === '') return null
                return (
                  <div key={def.key} className="flex justify-between border-b border-mist pb-1">
                    <dt className="text-brand-400">{def.label_tr}</dt>
                    <dd className="font-medium text-brand-700">{String(v)}{def.unit ? ` ${def.unit}` : ''}</dd>
                  </div>
                )
              })}
            </dl>
          </div>
        )}

        {/* Konumlar */}
        <div className="card mb-3 p-4">
          <div className="field-label">{t('part.locations')}</div>
          {places.length === 0 ? (
            <p className="text-sm text-brand-300">{t('search.no_location')}</p>
          ) : (
            <div className="flex flex-col">
              {places.map(({ stock, location }) => (
                <div key={location.id} className="flex items-center justify-between gap-3 border-b border-line py-3 last:border-0">
                  <Link to={`/l/${encodeURIComponent(location.code)}`} className="loc-code text-xl">
                    {location.code}
                  </Link>
                  <StockControl part={part} stock={stock} locationId={location.id} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Hareket geçmişi */}
        <div className="card mb-3 p-4">
          <div className="field-label">{t('part.history')}</div>
          {history.length === 0 ? (
            <p className="text-sm text-brand-300">{t('part.no_history')}</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {history.slice(0, 30).map((tx) => (
                <li key={tx.id} className="flex items-center justify-between border-b border-mist pb-1">
                  <span className="text-brand-500">
                    {REASON_LABEL[tx.reason]}
                    {tx.level_to ? ` → ${LEVEL_LABEL[tx.level_to]}` : ''}
                  </span>
                  <span className="flex items-center gap-2">
                    {tx.delta != null && (
                      <span className={`font-semibold tabular-nums ${tx.delta < 0 ? 'text-red-600' : 'text-green-700'}`}>
                        {tx.delta > 0 ? '+' : ''}{tx.delta}
                      </span>
                    )}
                    <span className="text-xs text-brand-300">{timeAgo(tx.created_at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {editing && (
          <button onClick={() => void remove()} className="btn-danger w-full">
            <IconTrash size={18} /> {t('common.delete')}
          </button>
        )}
      </Container>
    </>
  )
}
