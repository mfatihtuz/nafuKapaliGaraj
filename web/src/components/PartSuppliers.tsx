import { useState } from 'react'
import { useSuppliers, usePartSuppliers } from '../db/queries'
import { saveSupplier, savePartSupplier, deletePartSupplier } from '../db/actions'
import { useT } from '../i18n'
import { useToast } from './Toast'
import { safeHttpUrl } from '../lib/url'
import { IconTrash, IconPlus } from './icons'

const CURRENCIES = ['TRY', 'USD', 'EUR']

/** Parça detayında "Tedarikçiler & Fiyat" kartı (FAZ 3b 3.5). En ucuz önce; fiyat düzenle. */
export function PartSuppliers({ partId, canWrite }: { partId: string; canWrite: boolean }) {
  const { t } = useT()
  const toast = useToast()
  const suppliers = useSuppliers()
  const rows = usePartSuppliers(partId)
  const [adding, setAdding] = useState(false)
  const [supName, setSupName] = useState('')
  const [supId, setSupId] = useState('')
  const [sku, setSku] = useState('')
  const [url, setUrl] = useState('')
  const [price, setPrice] = useState('')
  const [cur, setCur] = useState('TRY')
  const [busy, setBusy] = useState(false)

  const fmtPrice = (p: number | null, c: string) => (p == null ? '—' : `${p.toLocaleString('tr', { maximumFractionDigits: 4 })} ${c}`)

  async function add() {
    const name = supName.trim()
    if (!supId && name === '') { toast.show(t('supplier.pick_or_name'), 'error'); return }
    setBusy(true)
    try {
      // Mevcut tedarikçi seçildi ya da yeni ad girildiyse önce onu oluştur.
      let sid = supId
      if (!sid) {
        const existing = suppliers.find((s) => s.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'))
        sid = existing ? existing.id : await saveSupplier({ name })
      }
      const priceNum = price.trim() === '' ? null : Number(price.replace(',', '.'))
      await savePartSupplier({
        partId, supplierId: sid, supplierSku: sku.trim() || null, productUrl: url.trim() || null,
        lastPrice: priceNum != null && Number.isFinite(priceNum) ? priceNum : null, currency: cur,
      })
      toast.show(t('supplier.saved'), 'success')
      setAdding(false); setSupName(''); setSupId(''); setSku(''); setUrl(''); setPrice('')
    } finally { setBusy(false) }
  }

  return (
    <div className="card mb-3 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="field-label">{t('supplier.title')}</div>
        {canWrite && !adding && (
          <button onClick={() => setAdding(true)} className="btn-ghost h-8 px-2 text-xs"><IconPlus size={14} /> {t('supplier.add')}</button>
        )}
      </div>

      {rows.length === 0 && !adding ? (
        <p className="text-sm text-brand-300">{t('supplier.empty')}</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((ps, i) => {
            const sup = suppliers.find((s) => s.id === ps.supplier_id)
            return (
              <div key={ps.id} className="flex items-center justify-between gap-2 border-b border-line py-1.5 text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-brand-700">{sup?.name ?? '—'}</span>
                    {i === 0 && ps.last_price != null && rows.length > 1 && (
                      <span className="chip bg-green-50 text-[10px] font-semibold text-green-700">{t('supplier.cheapest')}</span>
                    )}
                  </div>
                  {(ps.supplier_sku || safeHttpUrl(ps.product_url)) && (
                    <div className="truncate text-[11px] text-brand-400">
                      {ps.supplier_sku}
                      {safeHttpUrl(ps.product_url) && <> · <a href={safeHttpUrl(ps.product_url)} target="_blank" rel="noreferrer" className="text-accent hover:underline">{t('supplier.link')}</a></>}
                    </div>
                  )}
                </div>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums font-semibold text-brand-800">{fmtPrice(ps.last_price, ps.currency)}</span>
                  {canWrite && (
                    <button onClick={() => void deletePartSupplier(ps.id)} className="btn-icon h-7 w-7 text-brand-300"><IconTrash size={13} /></button>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {adding && (
        <div className="mt-3 space-y-2 rounded-lg border border-line p-3">
          <div className="flex gap-2">
            <select value={supId} onChange={(e) => setSupId(e.target.value)} className="select flex-1">
              <option value="">{t('supplier.new_or_pick')}</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {!supId && (
            <input value={supName} onChange={(e) => setSupName(e.target.value)} placeholder={t('supplier.name_placeholder')} className="input" />
          )}
          <div className="flex gap-2">
            <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder={t('supplier.sku')} className="input flex-1 font-mono" />
          </div>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('supplier.url')} className="input" inputMode="url" />
          <div className="flex gap-2">
            <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder={t('supplier.price')} className="input flex-1" inputMode="decimal" />
            <select value={cur} onChange={(e) => setCur(e.target.value)} className="select w-24">
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void add()} disabled={busy} className="btn-navy flex-1 text-sm disabled:opacity-50">{t('common.save')}</button>
            <button onClick={() => setAdding(false)} className="btn-ghost text-sm">{t('common.cancel')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
