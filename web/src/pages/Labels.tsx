import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AppHeader, Container } from '../components/Layout'
import { useLocations } from '../db/queries'
import { db } from '../db/dexie'
import type { TenantInfo } from '../db/types'
import { locationUrl, qrDataUrl } from '../lib/qr'
import { useT } from '../i18n'
import { IconTag } from '../components/icons'

interface LabelItem { code: string; dataUrl: string }

export function Labels() {
  const { t } = useT()
  const locations = useLocations()
  const tenant = useLiveQuery(async () => (await db.meta.get('tenant'))?.value as TenantInfo | undefined, [])

  const cabinets = useMemo(
    () => locations.filter((l) => l.type === 'cabinet').sort((a, b) => a.sort_order - b.sort_order),
    [locations],
  )
  const [cabinetId, setCabinetId] = useState('')
  const [labels, setLabels] = useState<LabelItem[]>([])
  const [busy, setBusy] = useState(false)

  const grid = tenant?.settings?.label_grid ?? { w_mm: 38, h_mm: 21, cols: 5, rows: 13 }

  async function generate() {
    const cab = cabinets.find((c) => c.id === cabinetId)
    if (!cab) return
    setBusy(true)
    const drawers = locations
      .filter((l) => l.type === 'drawer' && l.path.startsWith(cab.path + '/'))
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    const out: LabelItem[] = []
    for (const d of drawers) {
      const url = locationUrl(d.code, tenant?.settings?.qr_base_url)
      out.push({ code: d.code, dataUrl: await qrDataUrl(url, 160) })
    }
    setLabels(out)
    setBusy(false)
  }

  return (
    <>
      <AppHeader />
      <Container>
        <h1 className="mb-3 text-lg font-bold text-brand-800">{t('labels.title')}</h1>

        <div className="no-print card mb-4 p-4">
          <label className="field-label" htmlFor="cab">{t('labels.cabinet')}</label>
          <select
            id="cab"
            value={cabinetId}
            onChange={(e) => setCabinetId(e.target.value)}
            className="input mb-3"
          >
            <option value="">—</option>
            {cabinets.map((c) => (
              <option key={c.id} value={c.id}>{c.code} — {c.name ?? c.path}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button onClick={() => void generate()} disabled={!cabinetId || busy} className="btn-navy flex-1">
              <IconTag size={18} />
              {busy ? t('common.loading') : t('labels.generate')}
            </button>
            {labels.length > 0 && (
              <button onClick={() => window.print()} className="btn-primary flex-1">
                {t('labels.print')}
              </button>
            )}
          </div>
          {labels.length > 0 && (
            <p className="mt-2 text-xs text-brand-400">
              {t('labels.count', { n: labels.length })} · {t('labels.hint')}
            </p>
          )}
        </div>

        {/* Yazdırma alanı */}
        {labels.length > 0 && (
          <div
            className="grid gap-[1mm]"
            style={{ gridTemplateColumns: `repeat(${grid.cols}, ${grid.w_mm}mm)` }}
          >
            {labels.map((l) => (
              <div
                key={l.code}
                className="flex items-center gap-[1mm] overflow-hidden rounded-[1mm] border border-mist bg-white p-[1mm]"
                style={{ width: `${grid.w_mm}mm`, height: `${grid.h_mm}mm` }}
              >
                <img src={l.dataUrl} alt={l.code} style={{ width: `${grid.h_mm - 3}mm`, height: `${grid.h_mm - 3}mm` }} />
                <div className="min-w-0 leading-tight">
                  <div className="font-mono font-extrabold text-brand-900" style={{ fontSize: '10pt' }}>
                    {l.code}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Container>
    </>
  )
}
