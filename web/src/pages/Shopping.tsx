import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AppHeader, Container } from '../components/Layout'
import { useShoppingList, type ShoppingItem } from '../db/queries'
import { createPoFromShortages } from '../db/actions'
import { copyText } from '../lib/clipboard'
import { useT } from '../i18n'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { IconCart } from '../components/icons'

/** Eksik/alışveriş listesi (FAZ 2.4) — min stok altı + tükenenler, panoya kopyalanabilir. */
export function Shopping() {
  const { t } = useT()
  const toast = useToast()
  const { canWrite } = useAuth()
  const navigate = useNavigate()
  const items = useShoppingList()
  const [busy, setBusy] = useState(false)

  // Eksiklerden taslak sipariş: exact → (min-have, en az 1); level (bitti) → 1 adet.
  async function toOrder() {
    if (items.length === 0) return
    setBusy(true)
    try {
      const lines = items.map((it) => ({
        partId: it.part.id,
        qty: it.mode === 'exact' ? Math.max(1, Math.ceil(it.min - it.have)) : 1,
      }))
      const poId = await createPoFromShortages(lines)
      toast.show(t('po.created_from_shortages', { n: lines.length }), 'success')
      navigate(`/orders/${poId}`)
    } finally { setBusy(false) }
  }

  // Kategoriye göre grupla (kopya metni + görsel liste aynı sıradan).
  const groups = useMemo(() => {
    const map = new Map<string, ShoppingItem[]>()
    for (const it of items) {
      const k = it.categoryName ?? '—'
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(it)
    }
    return [...map.entries()]
  }, [items])

  function itemLine(it: ShoppingItem): string {
    const sku = it.part.sku ? ` (${it.part.sku})` : ''
    return it.mode === 'level'
      ? `- ${it.part.name}${sku} — ${t('shopping.out')}`
      : `- ${it.part.name}${sku} — ${t('shopping.have_min', { have: it.have, min: it.min })}`
  }

  async function copyAll() {
    const lines: string[] = [`${t('shopping.title')} — ${new Date().toISOString().slice(0, 10)}`, '']
    for (const [cat, list] of groups) {
      lines.push(cat)
      for (const it of list) lines.push(itemLine(it))
      lines.push('')
    }
    const ok = await copyText(lines.join('\n').trim())
    toast.show(ok ? t('shopping.copied') : t('shopping.copy_error'), ok ? 'success' : 'error')
  }

  return (
    <>
      <AppHeader back title={t('shopping.title')} right={
        <div className="flex items-center gap-2">
          <Link to="/orders" className="btn-ghost h-9 px-3 text-sm"><IconCart size={16} /> <span className="hidden sm:inline">{t('po.page_title')}</span></Link>
          {items.length > 0 && (
            <button onClick={() => void copyAll()} className="btn-ghost h-9 px-3 text-sm">{t('shopping.copy')}</button>
          )}
          {canWrite && items.length > 0 && (
            <button onClick={() => void toOrder()} disabled={busy} className="btn-primary h-9 px-3 text-sm disabled:opacity-50">{t('po.from_shortages')}</button>
          )}
        </div>
      } />
      <Container>
        {items.length === 0 ? (
          <div className="card card-pad mt-6 text-center">
            <IconCart size={30} className="mx-auto mb-2 text-brand-300" />
            <p className="text-brand-500">{t('shopping.empty')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-brand-400">{t('shopping.count', { n: items.length })}</p>
            {groups.map(([cat, list]) => (
              <div key={cat}>
                <div className="section-title mb-1.5">{cat}</div>
                <div className="space-y-1.5">
                  {list.map((it) => (
                    <Link key={it.part.id} to={`/parts/${it.part.id}`}
                      className="card flex items-center justify-between gap-2 p-3 transition-colors hover:border-accent">
                      <span className="flex items-center gap-2">
                        <span className="badge bg-brand-50 font-mono text-brand-500">{it.part.sku}</span>
                        <span className="font-medium text-brand-800">{it.part.name}</span>
                      </span>
                      {it.mode === 'level' ? (
                        <span className="chip bg-red-50 text-xs font-semibold text-red-600">{t('shopping.out')}</span>
                      ) : (
                        <span className={`text-xs ${it.out ? 'font-semibold text-red-600' : 'text-brand-400'}`}>
                          {t('shopping.have_min', { have: it.have, min: it.min })}
                        </span>
                      )}
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
