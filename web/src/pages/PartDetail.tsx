import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AppHeader, Container } from '../components/Layout'
import {
  usePart, useCategory, useCategories, useLocationsForPart, useTransactionsForPart, useLocations,
} from '../db/queries'
import type { CountMode, Part, Stock, Location } from '../db/types'
import { savePart, softDeletePart, movePartStock } from '../db/actions'
import { db } from '../db/dexie'
import { levelLabel, reasonLabel, unitLabel, timeAgo } from '../lib/format'
import { buildTags } from '../lib/sku'
import { UNITS } from '../lib/units'
import { StockControl } from '../components/StockControl'
import { AttributeForm } from '../components/AttributeForm'
import { useT } from '../i18n'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { IconEdit, IconTrash, IconCheck, IconMoveArrow } from '../components/icons'
import { LocationPicker, resolveLeaf } from '../components/LocationPicker'

const MODES: CountMode[] = ['exact', 'level', 'unmanaged']

/**
 * Bir konum kartı: üstte kod + yol, sağda stok kontrolü, altında açık etiketli
 * "Başka çekmeceye taşı" eylemi. (Eski tasarım: anlamı belirsiz "›" ikonuydu.)
 */
function LocationRow({
  part, stock, location, locations, canWrite,
}: {
  part: Part; stock: Stock; location: Location; locations: Location[]; canWrite: boolean
}) {
  const { t } = useT()
  const toast = useToast()
  const [moving, setMoving] = useState(false)
  const [dest, setDest] = useState('')

  const target = resolveLeaf(dest, locations)
  const canMove = !!target && target.id !== location.id

  async function doMove() {
    if (!target) return
    if (target.id === location.id) { setMoving(false); return }
    await movePartStock(part, location.id, target.id, stock)
    toast.show(t('part.moved', { code: target.code }), 'success')
    setMoving(false)
    setDest('')
  }

  return (
    <div className="rounded-xl border border-line bg-canvas/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/l/${encodeURIComponent(location.code)}`} className="loc-code text-xl">
            {location.code}
          </Link>
          <div className="truncate text-[11px] text-brand-300">{location.path}</div>
        </div>
        <StockControl part={part} stock={stock} locationId={location.id} />
      </div>

      {canWrite && !moving && (
        <button
          onClick={() => setMoving(true)}
          className="mt-2 flex items-center gap-1.5 text-xs font-medium text-brand-500 hover:text-brand-800"
        >
          <IconMoveArrow size={14} /> {t('part.move_action')}
        </button>
      )}

      {moving && (
        <div className="mt-3 rounded-lg border border-line bg-white p-3">
          <div className="field-label">{t('part.move_to_label', { code: location.code })}</div>
          <LocationPicker value={dest} onChange={setDest} locations={locations} autoFocus />
          <div className="mt-2 flex justify-end gap-2">
            <button onClick={() => { setMoving(false); setDest('') }} className="btn-ghost h-9 px-3 text-sm">
              {t('common.cancel')}
            </button>
            <button onClick={() => void doMove()} disabled={!canMove} className="btn-primary h-9 px-4 text-sm">
              <IconMoveArrow size={15} /> {t('part.move')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function PartDetail() {
  const { id = '' } = useParams()
  const { t } = useT()
  const { canWrite } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const part = usePart(id)
  const category = useCategory(part?.category_id)
  const categories = useCategories()
  const places = useLocationsForPart(id)
  const history = useTransactionsForPart(id)
  const locations = useLocations()

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
  // Düzenlerken öznitelik formu, DRAFT'ın kategorisinin şemasına göre gösterilir.
  const draftCategory = editing && draft
    ? categories.find((c) => c.id === draft.category_id) ?? category
    : category

  function startEdit() {
    setDraft({ ...part! })
    setEditing(true)
  }
  function cancelEdit() {
    setEditing(false)
    setDraft(null)
  }
  async function save() {
    if (!draft) return
    const sku = draft.sku.trim().toUpperCase()
    if (!sku) { toast.show(t('part.sku_required'), 'error'); return }
    // SKU parçanın tekil kimliği — değiştiyse başka aktif parçayla çakışmamalı.
    if (sku !== part!.sku) {
      const clash = await db.parts.where('sku').equals(sku).first()
      if (clash && clash.id !== draft.id && !clash.deleted_at) {
        toast.show(t('part.sku_taken', { code: sku }), 'error'); return
      }
    }
    // Ad/kategori/özellik değişmiş olabilir — arama etiketlerini yeniden üret.
    await savePart({ ...draft, sku, tags: buildTags(draft.name, draft.attributes, draftCategory, draft.manufacturer, draft.mpn) })
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

  const schema = draftCategory?.attribute_schema ?? null

  return (
    <>
      <AppHeader
        back
        right={
          !canWrite ? null : editing ? (
            <div className="flex items-center gap-1.5">
              <button onClick={cancelEdit} className="btn h-9 px-3 text-sm text-brand-500 hover:bg-brand-50">
                {t('common.cancel')}
              </button>
              <button onClick={() => void save()} className="btn-primary h-9 px-3 text-sm">
                <IconCheck size={16} /> {t('common.save')}
              </button>
            </div>
          ) : (
            /* Başlık zemini BEYAZ — buton koyu renk olmalı (beyaz-üstü-beyaz görünmezdi). */
            <button onClick={startEdit} aria-label={t('part.edit')} title={t('part.edit')} className="btn-icon h-9 w-9 text-brand-600 hover:bg-brand-50">
              <IconEdit size={18} />
            </button>
          )
        }
      />
      <Container>
        {/* Başlık */}
        <div className="card mb-3 p-4">
          {editing ? (
            <div className="grid gap-3">
              <div>
                <label className="field-label" htmlFor="pname">{t('part.name')}</label>
                <input id="pname" className="input text-lg font-bold" value={current.name}
                  onChange={(e) => setDraft({ ...current, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label" htmlFor="psku">{t('part.code')}</label>
                  <input id="psku" className="input font-mono uppercase" value={current.sku}
                    onChange={(e) => setDraft({ ...current, sku: e.target.value })} />
                </div>
                <div>
                  <label className="field-label" htmlFor="pcat">{t('common.category')}</label>
                  <select id="pcat" className="select" value={current.category_id ?? ''}
                    onChange={(e) => setDraft({ ...current, category_id: e.target.value || null })}>
                    <option value="">{t('common.none')}</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name_tr}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="pman">{t('part.manufacturer')}</label>
                  <input id="pman" className="input" value={current.manufacturer ?? ''}
                    onChange={(e) => setDraft({ ...current, manufacturer: e.target.value || null })} />
                </div>
                <div>
                  <label className="field-label" htmlFor="pmpn">{t('part.mpn')}</label>
                  <input id="pmpn" className="input font-mono" value={current.mpn ?? ''}
                    onChange={(e) => setDraft({ ...current, mpn: e.target.value || null })} />
                </div>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-bold text-brand-800">{part.name}</h1>
              <div className="font-mono text-sm text-brand-400">{part.sku}</div>
              {(part.mpn || part.manufacturer) && (
                <div className="mt-1 text-xs text-brand-400">
                  {[part.manufacturer, part.mpn].filter(Boolean).join(' · ')}
                </div>
              )}
            </>
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
                  {UNITS.map((u) => <option key={u} value={u}>{unitLabel(t, u)}</option>)}
                  {!UNITS.includes(current.unit as never) && <option value={current.unit}>{unitLabel(t, current.unit)}</option>}
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
        {editing && draft ? (
          (schema && schema.length > 0) && (
            <div className="card mb-3 p-4">
              <div className="field-label mb-2">{t('part.attributes')}</div>
              <AttributeForm
                schema={schema}
                values={draft.attributes ?? {}}
                onChange={(k, v) => setDraft({ ...draft, attributes: { ...(draft.attributes ?? {}), [k]: v } })}
              />
            </div>
          )
        ) : (
          part.attributes && Object.keys(part.attributes).length > 0 && (
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
          )
        )}

        {/* Not + veri sayfası (datasheet) */}
        {editing && draft ? (
          <div className="card mb-3 p-4">
            <label className="field-label" htmlFor="pnote">{t('common.notes')}</label>
            <textarea id="pnote" rows={2} className="input mb-3" value={draft.notes ?? ''}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })} />
            <label className="field-label" htmlFor="pds">{t('part.datasheet')}</label>
            <input id="pds" type="url" inputMode="url" className="input font-mono text-sm" placeholder="https://…"
              value={draft.datasheet_url ?? ''} onChange={(e) => setDraft({ ...draft, datasheet_url: e.target.value || null })} />
          </div>
        ) : (part.notes || part.datasheet_url) && (
          <div className="card mb-3 p-4">
            {part.notes && <><div className="field-label">{t('common.notes')}</div><p className="mb-2 whitespace-pre-wrap text-sm text-brand-700">{part.notes}</p></>}
            {part.datasheet_url && (
              <a href={part.datasheet_url} target="_blank" rel="noreferrer" className="text-sm font-medium text-accent-700 underline">
                {t('part.datasheet')} ↗
              </a>
            )}
          </div>
        )}

        {/* Konumlar */}
        <div className="card mb-3 p-4">
          <div className="field-label">{t('part.locations')}</div>
          {places.length === 0 ? (
            <p className="text-sm text-brand-300">{t('search.no_location')}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {places.map(({ stock, location }) => (
                <LocationRow
                  key={location.id}
                  part={part}
                  stock={stock}
                  location={location}
                  locations={locations}
                  canWrite={canWrite}
                />
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
                    {reasonLabel(t, tx.reason)}
                    {tx.level_to ? ` → ${levelLabel(t, tx.level_to)}` : ''}
                  </span>
                  <span className="flex items-center gap-2">
                    {tx.delta != null && (
                      <span className={`font-semibold tabular-nums ${tx.delta < 0 ? 'text-red-600' : 'text-green-700'}`}>
                        {tx.delta > 0 ? '+' : ''}{tx.delta}
                      </span>
                    )}
                    <span className="text-xs text-brand-300">{timeAgo(t, tx.created_at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Tehlike bölgesi — parçayı depodan kaldır (arşivle). Kayıtlar silinmez. */}
        {canWrite && !editing && (
          <div className="card mt-4 border-red-100 p-4">
            <div className="field-label text-red-600">{t('part.danger_zone')}</div>
            <p className="mb-3 text-xs text-brand-400">{t('part.archive_hint')}</p>
            <button onClick={() => void remove()} className="btn-danger w-full">
              <IconTrash size={18} /> {t('part.archive')}
            </button>
          </div>
        )}
      </Container>
    </>
  )
}
