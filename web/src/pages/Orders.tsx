import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AppHeader, Container } from '../components/Layout'
import { usePurchaseOrders, useSuppliers } from '../db/queries'
import { savePurchaseOrder } from '../db/actions'
import type { PurchaseOrder, PoStatus } from '../db/types'
import { useT } from '../i18n'
import { useAuth } from '../auth/AuthContext'
import { IconCart, IconPlus } from '../components/icons'

const STATUS_ORDER: PoStatus[] = ['draft', 'ordered', 'received', 'cancelled']

export function PoStatusBadge({ status }: { status: PoStatus }) {
  const { t } = useT()
  const cls =
    status === 'ordered' ? 'bg-amber-100 text-amber-800'
    : status === 'received' ? 'bg-green-100 text-green-800'
    : status === 'cancelled' ? 'bg-brand-50 text-brand-400'
    : 'bg-brand-100 text-brand-600'
  return <span className={`chip text-[11px] font-semibold ${cls}`}>{t(`po.status.${status}`)}</span>
}

/** Siparişler ekranı (FAZ 3b 3.6): satın alma siparişleri, duruma göre gruplu. */
export function Orders() {
  const { t } = useT()
  const navigate = useNavigate()
  const { canWrite } = useAuth()
  const orders = usePurchaseOrders()
  const suppliers = useSuppliers()
  const [busy, setBusy] = useState(false)

  const supName = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers])

  const groups = useMemo(() => {
    const map = new Map<PoStatus, PurchaseOrder[]>()
    for (const o of orders) {
      if (!map.has(o.status)) map.set(o.status, [])
      map.get(o.status)!.push(o)
    }
    return STATUS_ORDER.filter((s) => map.has(s)).map((s) => [s, map.get(s)!] as const)
  }, [orders])

  async function create() {
    setBusy(true)
    try {
      const id = await savePurchaseOrder({ status: 'draft' })
      navigate(`/orders/${id}`)
    } finally { setBusy(false) }
  }

  return (
    <>
      <AppHeader back title={t('po.page_title')} right={
        canWrite ? (
          <button onClick={() => void create()} disabled={busy} className="btn-primary h-9 px-3 text-sm disabled:opacity-50">
            <IconPlus size={16} /> {t('po.new')}
          </button>
        ) : null
      } />
      <Container>
        {orders.length === 0 ? (
          <div className="card card-pad mt-6 text-center">
            <IconCart size={30} className="mx-auto mb-2 text-brand-300" />
            <p className="text-brand-500">{t('po.empty')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map(([status, list]) => (
              <div key={status}>
                <div className="section-title mb-1.5 flex items-center gap-2">
                  {t(`po.status.${status}`)} <span className="text-brand-300">({list.length})</span>
                </div>
                <div className="space-y-2">
                  {list.map((o) => (
                    <Link key={o.id} to={`/orders/${o.id}`}
                      className="card flex items-center justify-between gap-2 p-3 transition-colors hover:border-accent">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-brand-800">
                          {o.supplier_id ? (supName.get(o.supplier_id) ?? t('po.no_supplier')) : t('po.no_supplier')}
                        </div>
                        <div className="text-[11px] text-brand-300">
                          {o.ordered_at ? t('po.ordered_on', { date: o.ordered_at.slice(0, 10) }) : t('po.draft_hint')}
                        </div>
                      </div>
                      <PoStatusBadge status={o.status} />
                    </Link>
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
