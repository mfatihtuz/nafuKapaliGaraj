import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppHeader, Container } from '../components/Layout'
import { useOpenLoans, useParts, useLocations } from '../db/queries'
import { returnLoan } from '../db/actions'
import { db } from '../db/dexie'
import type { Loan, Part, StockLevel, Location } from '../db/types'
import { isFreeStock } from '../lib/freeStock'
import { useT } from '../i18n'
import { useToast } from '../components/Toast'
import { useAuth } from '../auth/AuthContext'
import { LocationPicker, resolveLeaf } from '../components/LocationPicker'
import { IconLoan, IconUndo } from '../components/icons'

/**
 * Ödünçler ekranı (FAZ 3b 3.4): kimde ne var? Açık ödünçler borçluya göre gruplanır;
 * vadesi geçmişler kırmızı rozetle en üstte. Her satırdan tek dokunuşla iade alınır.
 */
export function Loans() {
  const { t } = useT()
  const { canWrite } = useAuth()
  const loans = useOpenLoans()
  const parts = useParts()
  const locations = useLocations()

  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts])
  const destLocations = useMemo(() => locations.filter((l) => isFreeStock(l)), [locations])

  // Borçluya göre grupla (borçlu adı + iletişim eşleşen ödünçler bir arada).
  const groups = useMemo(() => {
    const map = new Map<string, Loan[]>()
    for (const l of loans) {
      const key = l.borrower
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(l)
    }
    return [...map.entries()]
  }, [loans])

  return (
    <>
      <AppHeader back title={t('loan.page_title')} />
      <Container>
        {loans.length === 0 ? (
          <div className="card card-pad mt-6 text-center">
            <IconLoan size={30} className="mx-auto mb-2 text-brand-300" />
            <p className="text-brand-500">{t('loan.page_empty')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-brand-400">{t('loan.open_count', { n: loans.length })}</p>
            {groups.map(([borrower, list]) => (
              <div key={borrower}>
                <div className="section-title mb-1.5 flex items-center gap-2">
                  {borrower} <span className="text-brand-300">({list.length})</span>
                  {list[0].borrower_contact && <span className="text-xs font-normal text-brand-400">· {list[0].borrower_contact}</span>}
                </div>
                <div className="card divide-y divide-line">
                  {list.map((l) => (
                    <LoanItem key={l.id} loan={l} part={partsById.get(l.part_id)} destLocations={destLocations} canWrite={canWrite} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Container>
    </>
  )
}

function LoanItem({
  loan, part, destLocations, canWrite,
}: {
  loan: Loan; part: Part | undefined; destLocations: Location[]; canWrite: boolean
}) {
  const { t } = useT()
  const toast = useToast()
  const [returning, setReturning] = useState(false)
  const [dest, setDest] = useState('')
  const [busy, setBusy] = useState(false)

  const overdue = loan.due_at != null && loan.due_at < new Date().toISOString()

  async function doReturn() {
    if (!part) return
    const target = resolveLeaf(dest, destLocations)
    if (!target) { toast.show(t('loan.pick_dest'), 'error'); return }
    setBusy(true)
    try {
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
    <div className="p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          {part ? (
            <Link to={`/parts/${part.id}`} className="truncate font-medium text-brand-800 hover:text-accent">{part.name}</Link>
          ) : (
            <span className="truncate font-medium text-brand-400">{t('loan.unknown_part')}</span>
          )}
          <div className="text-[11px] text-brand-300">
            {part?.count_mode === 'exact' && <>{t('loan.qty')}: {loan.qty} · </>}
            {loan.due_at ? t('loan.due_on', { date: loan.due_at.slice(0, 10) }) : t('loan.no_due')}
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-2">
          {overdue && <span className="chip bg-red-50 text-[10px] font-semibold text-red-700">{t('loan.overdue')}</span>}
          {canWrite && part && !returning && (
            <button onClick={() => setReturning(true)} className="btn-ghost h-8 gap-1 px-2 text-xs">
              <IconUndo size={13} /> {t('loan.return')}
            </button>
          )}
        </span>
      </div>
      {returning && (
        <div className="mt-2 rounded-lg border border-line bg-white p-2">
          <div className="field-label">{t('loan.return_to')}</div>
          <LocationPicker value={dest} onChange={setDest} locations={destLocations} autoFocus />
          <div className="mt-2 flex justify-end gap-2">
            <button onClick={() => { setReturning(false); setDest('') }} className="btn-ghost h-8 px-3 text-xs">{t('common.cancel')}</button>
            <button onClick={() => void doReturn()} disabled={busy} className="btn-primary h-8 px-3 text-xs disabled:opacity-50">{t('loan.return')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
