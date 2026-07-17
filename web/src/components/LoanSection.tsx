import { useMemo, useState } from 'react'
import type { Part, StockLevel, Location, Loan } from '../db/types'
import type { StockWithLocation } from '../db/queries'
import { useLoansForPart } from '../db/queries'
import { lendPart, returnLoan } from '../db/actions'
import { db } from '../db/dexie'
import { isFreeStock } from '../lib/freeStock'
import { useT } from '../i18n'
import { useToast } from './Toast'
import { LocationPicker, resolveLeaf } from './LocationPicker'
import { IconLoan, IconUndo } from './icons'

/**
 * Parça detayında "Ödünç" kartı (FAZ 3b 3.4): parçayı birine ödünç ver (kaynak gözden
 * borçlunun sanal LOAN gözüne) + açık ödünçleri listele + iade al. Stok defterle taşınır
 * (loan_out/loan_return); ödünç kaydı ayrı LWW satır. Vadesi geçmiş kayıt rozetle işaretlenir.
 */
export function LoanSection({
  part, places, allLocations, canWrite,
}: {
  part: Part; places: StockWithLocation[]; allLocations: Location[]; canWrite: boolean
}) {
  const { t } = useT()
  const toast = useToast()
  const loans = useLoansForPart(part.id)
  const [lending, setLending] = useState(false)
  const [busy, setBusy] = useState(false)

  // Ödünç verilebilir kaynaklar: serbest (proje/ödünç/karantina DIŞI) ve stoğu olan gözler.
  const sources = useMemo(
    () => places.filter(({ stock, location }) =>
      isFreeStock(location)
      && (part.count_mode === 'level' ? stock.level != null && stock.level !== 'empty' : Number(stock.qty) > 0)),
    [places, part.count_mode],
  )

  const [borrower, setBorrower] = useState('')
  const [contact, setContact] = useState('')
  const [srcId, setSrcId] = useState('')
  const [qty, setQty] = useState('1')
  const [due, setDue] = useState('')

  const src = sources.find((s) => s.location.id === srcId) ?? sources[0]
  const maxQty = src ? Math.max(0, Math.floor(Number(src.stock.qty))) : 0

  async function doLend() {
    if (!src) { toast.show(t('loan.no_source'), 'error'); return }
    const name = borrower.trim()
    if (!name) { toast.show(t('loan.borrower_required'), 'error'); return }
    const n = part.count_mode === 'exact' ? Math.min(maxQty, Math.max(1, Math.floor(Number(qty) || 0))) : 1
    if (part.count_mode === 'exact' && n <= 0) { toast.show(t('loan.qty_invalid'), 'error'); return }
    setBusy(true)
    try {
      await lendPart({
        part, fromLocationId: src.location.id, qty: n, borrower: name,
        borrowerContact: contact.trim() || null,
        dueAt: due ? new Date(due + 'T00:00:00Z').toISOString() : null,
        fromLevel: src.stock.level ?? 'full',
      })
      toast.show(t('loan.lent', { name }), 'success')
      setLending(false); setBorrower(''); setContact(''); setQty('1'); setDue('')
    } finally { setBusy(false) }
  }

  return (
    <div className="card mb-3 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="field-label flex items-center gap-1.5"><IconLoan size={15} /> {t('loan.title')}</div>
        {canWrite && !lending && sources.length > 0 && (
          <button onClick={() => { setSrcId(sources[0].location.id); setLending(true) }} className="btn-ghost h-8 px-2 text-xs">
            <IconLoan size={14} /> {t('loan.lend')}
          </button>
        )}
      </div>

      {loans.length === 0 && !lending ? (
        <p className="text-sm text-brand-300">{t('loan.none')}</p>
      ) : (
        <div className="space-y-1.5">
          {loans.map((l) => (
            <LoanRow key={l.id} loan={l} part={part} allLocations={allLocations} canWrite={canWrite} />
          ))}
        </div>
      )}

      {lending && (
        <div className="mt-3 space-y-2 rounded-lg border border-line p-3">
          <input autoFocus value={borrower} onChange={(e) => setBorrower(e.target.value)}
            placeholder={t('loan.borrower_placeholder')} className="input" />
          <input value={contact} onChange={(e) => setContact(e.target.value)}
            placeholder={t('loan.contact_placeholder')} className="input" />
          <div className="field-label mt-1">{t('loan.source')}</div>
          <select value={src?.location.id ?? ''} onChange={(e) => setSrcId(e.target.value)} className="select">
            {sources.map(({ location, stock }) => (
              <option key={location.id} value={location.id}>
                {location.code} · {part.count_mode === 'level' ? t(`level.${stock.level ?? 'full'}`) : `${Math.floor(Number(stock.qty))}`}
              </option>
            ))}
          </select>
          {part.count_mode === 'exact' && (
            <div className="flex items-center gap-2">
              <span className="field-label mb-0">{t('loan.qty')}</span>
              <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric"
                className="input w-24 text-center" />
              <span className="text-xs text-brand-400">/ {maxQty}</span>
            </div>
          )}
          <div>
            <div className="field-label">{t('loan.due')}</div>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="input" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => void doLend()} disabled={busy} className="btn-navy flex-1 text-sm disabled:opacity-50">
              {t('loan.lend')}
            </button>
            <button onClick={() => setLending(false)} className="btn-ghost text-sm">{t('common.cancel')}</button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Tek açık ödünç satırı: borçlu + adet + vade rozeti + iade al akışı. */
function LoanRow({
  loan, part, allLocations, canWrite,
}: {
  loan: Loan; part: Part; allLocations: Location[]; canWrite: boolean
}) {
  const { t } = useT()
  const toast = useToast()
  const [returning, setReturning] = useState(false)
  const [dest, setDest] = useState('')
  const [busy, setBusy] = useState(false)
  // İade hedefi: yalnız gerçek gözler (proje/ödünç/karantina sanal konumları hariç).
  const locations = useMemo(() => allLocations.filter((l) => isFreeStock(l)), [allLocations])

  const overdue = loan.due_at != null && loan.due_at < new Date().toISOString()

  async function doReturn() {
    const target = resolveLeaf(dest, locations)
    if (!target) { toast.show(t('loan.pick_dest'), 'error'); return }
    setBusy(true)
    try {
      // İade edilen gözün doluluğu (level parça) — LOAN gözünün mevcut seviyesi.
      let level: StockLevel | null = 'full'
      if (part.count_mode === 'level') {
        const s = await db.stock.where('[part_id+location_id]').equals([part.id, loan.location_id]).first()
        level = s?.level ?? 'full'
      }
      await returnLoan(loan, part, target.id, level)
      toast.show(t('loan.returned'), 'success')
      setReturning(false); setDest('')
    } finally { setBusy(false) }
  }

  return (
    <div className="border-b border-line py-1.5 text-sm last:border-0">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="truncate font-medium text-brand-700">{loan.borrower}</span>
          {loan.borrower_contact && <span className="ml-1.5 text-[11px] text-brand-400">{loan.borrower_contact}</span>}
        </div>
        <span className="flex shrink-0 items-center gap-2">
          {overdue && <span className="chip bg-red-50 text-[10px] font-semibold text-red-700">{t('loan.overdue')}</span>}
          {part.count_mode === 'exact' && <span className="tabular-nums font-semibold text-brand-800">{loan.qty}</span>}
          {canWrite && !returning && (
            <button onClick={() => setReturning(true)} className="btn-ghost h-7 gap-1 px-2 text-[11px]">
              <IconUndo size={12} /> {t('loan.return')}
            </button>
          )}
        </span>
      </div>
      {returning && (
        <div className="mt-2 rounded-lg border border-line bg-white p-2">
          <div className="field-label">{t('loan.return_to')}</div>
          <LocationPicker value={dest} onChange={setDest} locations={locations} autoFocus />
          <div className="mt-2 flex justify-end gap-2">
            <button onClick={() => { setReturning(false); setDest('') }} className="btn-ghost h-8 px-3 text-xs">{t('common.cancel')}</button>
            <button onClick={() => void doReturn()} disabled={busy} className="btn-primary h-8 px-3 text-xs disabled:opacity-50">
              {t('loan.return')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
