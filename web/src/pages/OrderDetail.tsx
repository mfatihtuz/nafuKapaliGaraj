import { useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { AppHeader, Container } from '../components/Layout'
import { usePurchaseOrder, usePoItems, useSuppliers, useParts, useLocations } from '../db/queries'
import {
  savePurchaseOrder, setPoStatus, softDeletePurchaseOrder, savePoItem, deletePoItem, receivePoItem,
} from '../db/actions'
import type { PoItem, PoStatus, Part, Location } from '../db/types'
import { searchMatch } from '../lib/normalize'
import { isFreeStock } from '../lib/freeStock'
import { useT } from '../i18n'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { PoStatusBadge } from './Orders'
import { LocationPicker, resolveLeaf } from '../components/LocationPicker'
import { IconTrash, IconPlus, IconCheck } from '../components/icons'

const NEXT: Partial<Record<PoStatus, PoStatus>> = { draft: 'ordered', ordered: 'received' }

export function OrderDetail() {
  const { id = '' } = useParams()
  const { t } = useT()
  const navigate = useNavigate()
  const toast = useToast()
  const { canWrite } = useAuth()
  const po = usePurchaseOrder(id)
  const items = usePoItems(id)
  const suppliers = useSuppliers()
  const parts = useParts()
  const locations = useLocations()

  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts])
  const destLocations = useMemo(() => locations.filter((l) => isFreeStock(l)), [locations])

  const total = useMemo(
    () => items.reduce((sum, it) => sum + Number(it.qty) * Number(it.unit_price ?? 0), 0),
    [items],
  )

  if (po === undefined) return <><AppHeader back /><Container><p className="py-16 text-center text-brand-400">{t('common.loading')}</p></Container></>
  if (!po || po.deleted_at) return <><AppHeader back /><Container><p className="py-16 text-center text-brand-400">{t('po.not_found')}</p></Container></>

  const editable = canWrite && (po.status === 'draft' || po.status === 'ordered')
  const next = NEXT[po.status]

  async function changeSupplier(sid: string) {
    await savePurchaseOrder({ id: po!.id, supplierId: sid || null })
  }
  async function advance() {
    if (!next) return
    // 'received'e geçerken tüm satırlar teslim alınmış olmalı uyarısı (yine de izin ver — kısmi olabilir)
    await setPoStatus(po!, next)
    toast.show(t(`po.moved_${next}`), 'success')
  }
  async function cancel() {
    await setPoStatus(po!, 'cancelled')
    toast.show(t('po.cancelled'), 'success')
  }
  async function remove() {
    if (!confirm(t('po.delete_confirm'))) return
    await softDeletePurchaseOrder(po!.id)
    toast.show(t('common.delete'), 'success')
    navigate('/orders')
  }

  return (
    <>
      <AppHeader back title={t('po.detail_title')} right={<PoStatusBadge status={po.status} />} />
      <Container>
        {/* Başlık: tedarikçi + durum kontrolleri */}
        <div className="card mb-3 p-4">
          <div className="field-label">{t('po.supplier')}</div>
          {editable ? (
            <select value={po.supplier_id ?? ''} onChange={(e) => void changeSupplier(e.target.value)} className="select">
              <option value="">{t('po.no_supplier')}</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : (
            <p className="text-sm text-brand-700">{po.supplier_id ? (suppliers.find((s) => s.id === po.supplier_id)?.name ?? '—') : t('po.no_supplier')}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {canWrite && next && (
              <button onClick={() => void advance()} className="btn-navy h-9 px-3 text-sm">
                <IconCheck size={15} /> {t(`po.advance_${next}`)}
              </button>
            )}
            {canWrite && po.status !== 'received' && po.status !== 'cancelled' && (
              <button onClick={() => void cancel()} className="btn-ghost h-9 px-3 text-sm">{t('po.cancel_order')}</button>
            )}
          </div>
        </div>

        {/* Satırlar */}
        <div className="card mb-3 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="field-label mb-0">{t('po.lines')}</div>
            <div className="text-sm font-semibold tabular-nums text-brand-800">
              {t('po.total')}: {total.toLocaleString('tr', { maximumFractionDigits: 2 })} {po.currency}
            </div>
          </div>
          {items.length === 0 ? (
            <p className="text-sm text-brand-300">{t('po.no_lines')}</p>
          ) : (
            <div className="space-y-1.5">
              {items.map((it) => (
                <PoLineRow key={it.id} item={it} part={it.part_id ? partsById.get(it.part_id) : undefined}
                  destLocations={destLocations} editable={editable} canReceive={canWrite && po.status !== 'draft' && po.status !== 'cancelled'} />
              ))}
            </div>
          )}
          {editable && <AddLine poId={po.id} parts={parts} />}
        </div>

        {canWrite && (
          <div className="card mt-4 border-red-100 p-4">
            <div className="field-label text-red-600">{t('po.danger_zone')}</div>
            <button onClick={() => void remove()} className="btn-danger w-full"><IconTrash size={18} /> {t('po.delete')}</button>
          </div>
        )}
      </Container>
    </>
  )
}

/** Tek sipariş satırı: parça/ham ad + adet + fiyat + teslim durumu + teslim al akışı. */
function PoLineRow({
  item, part, destLocations, editable, canReceive,
}: {
  item: PoItem; part: Part | undefined; destLocations: Location[]; editable: boolean; canReceive: boolean
}) {
  const { t } = useT()
  const toast = useToast()
  const [receiving, setReceiving] = useState(false)
  const [dest, setDest] = useState('')
  const [qty, setQty] = useState('')
  const [busy, setBusy] = useState(false)

  const remaining = Math.max(0, Number(item.qty) - Number(item.received_qty))
  const fullyReceived = remaining <= 0

  async function doReceive() {
    const target = resolveLeaf(dest, destLocations)
    if (!target) { toast.show(t('po.pick_dest'), 'error'); return }
    const n = Math.min(remaining, Math.max(1, Math.floor(Number(qty) || remaining)))
    if (n <= 0) { toast.show(t('po.qty_invalid'), 'error'); return }
    setBusy(true)
    try {
      await receivePoItem(item, target.id, n)
      toast.show(t('po.received_line'), 'success')
      setReceiving(false); setDest(''); setQty('')
    } catch (e) {
      toast.show((e as Error).message === 'PO_ITEM_NO_PART' ? t('po.raw_not_receivable') : t('common.error'), 'error')
    } finally { setBusy(false) }
  }

  return (
    <div className="border-b border-line py-1.5 text-sm last:border-0">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          {part ? (
            <Link to={`/parts/${part.id}`} className="truncate font-medium text-brand-700 hover:text-accent">{part.name}</Link>
          ) : (
            <span className="truncate font-medium text-brand-500">{item.raw_name || t('po.unnamed_line')}</span>
          )}
          <div className="text-[11px] text-brand-400">
            {Number(item.qty)} × {item.unit_price != null ? `${Number(item.unit_price).toLocaleString('tr', { maximumFractionDigits: 4 })}` : '—'}
            {Number(item.received_qty) > 0 && <> · {t('po.received_n', { n: Number(item.received_qty) })}</>}
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-2">
          {fullyReceived ? (
            <span className="chip bg-green-50 text-[10px] font-semibold text-green-700"><IconCheck size={11} /> {t('po.done')}</span>
          ) : canReceive && part ? (
            <button onClick={() => { setReceiving((v) => !v); setQty(String(remaining)) }} className="btn-ghost h-7 px-2 text-[11px]">{t('po.receive')}</button>
          ) : null}
          {editable && (
            <button onClick={() => void deletePoItem(item.id)} className="btn-icon h-7 w-7 text-brand-300"><IconTrash size={13} /></button>
          )}
        </span>
      </div>
      {receiving && (
        <div className="mt-2 space-y-2 rounded-lg border border-line bg-white p-2">
          <div className="field-label">{t('po.receive_to')}</div>
          <LocationPicker value={dest} onChange={setDest} locations={destLocations} autoFocus />
          <div className="flex items-center gap-2">
            <span className="field-label mb-0">{t('po.receive_qty')}</span>
            <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" className="input w-24 text-center" />
            <span className="text-xs text-brand-400">/ {remaining}</span>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => { setReceiving(false); setDest('') }} className="btn-ghost h-8 px-3 text-xs">{t('common.cancel')}</button>
            <button onClick={() => void doReceive()} disabled={busy} className="btn-primary h-8 px-3 text-xs disabled:opacity-50">{t('po.receive')}</button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Yeni satır ekle: parça ara-seç (combobox) ya da katalogda olmayan ham ad + adet + fiyat. */
function AddLine({ poId, parts }: { poId: string; parts: Part[] }) {
  const { t } = useT()
  const [q, setQ] = useState('')
  const [partId, setPartId] = useState<string | null>(null)
  const [qty, setQty] = useState('1')
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)

  const matches = useMemo(() => {
    const s = q.trim()
    if (partId || s === '') return []
    return parts.filter((p) => searchMatch(s, p.sku, p.name, p.mpn, p.tags)).slice(0, 6)
  }, [q, partId, parts])

  async function add() {
    const n = Math.max(1, Math.floor(Number(qty) || 0))
    const priceNum = price.trim() === '' ? null : Number(price.replace(',', '.'))
    const name = q.trim()
    if (!partId && name === '') return
    setBusy(true)
    try {
      await savePoItem({
        poId, partId: partId ?? null, rawName: partId ? null : name, qty: n,
        unitPrice: priceNum != null && Number.isFinite(priceNum) ? priceNum : null,
      })
      setQ(''); setPartId(null); setQty('1'); setPrice('')
    } finally { setBusy(false) }
  }

  const selectedPart = partId ? parts.find((p) => p.id === partId) : undefined

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-line p-3">
      <div className="field-label mb-0">{t('po.add_line')}</div>
      {selectedPart ? (
        <div className="flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2 text-sm">
          <span className="font-medium text-brand-800">{selectedPart.name}</span>
          <button onClick={() => { setPartId(null); setQ('') }} className="text-xs text-brand-400 hover:text-brand-700">{t('po.change_part')}</button>
        </div>
      ) : (
        <div className="relative">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('po.part_search')} className="input" />
          {matches.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-line bg-white shadow-lg">
              {matches.map((p) => (
                <button key={p.id} onClick={() => { setPartId(p.id); setQ(p.name) }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-brand-50">
                  <span className="badge bg-brand-50 font-mono text-[10px] text-brand-500">{p.sku}</span>
                  <span className="truncate text-brand-800">{p.name}</span>
                </button>
              ))}
            </div>
          )}
          {q.trim() !== '' && matches.length === 0 && (
            <p className="mt-1 text-[11px] text-brand-400">{t('po.raw_hint')}</p>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" placeholder={t('po.qty')} className="input w-24 text-center" />
        <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder={t('po.unit_price')} className="input flex-1" />
        <button onClick={() => void add()} disabled={busy || (!partId && q.trim() === '')} className="btn-navy px-4 text-sm disabled:opacity-50">
          <IconPlus size={15} />
        </button>
      </div>
    </div>
  )
}
