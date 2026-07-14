import { useMemo, useState } from 'react'
import { AppHeader, Container } from '../components/Layout'
import { useLocations } from '../db/queries'
import { useAuth } from '../auth/AuthContext'
import { locationUrl, qrDataUrl } from '../lib/qr'
import { useT } from '../i18n'
import { IconTag } from '../components/icons'

interface LabelItem { code: string; dataUrl: string }

export function Labels() {
  const { t } = useT()
  const { auth } = useAuth()
  const locations = useLocations()
  const settings = auth?.tenant.settings
  const types = settings?.label_types ?? []

  const cabinets = useMemo(
    () => locations.filter((l) => l.type === 'cabinet').sort((a, b) => a.sort_order - b.sort_order),
    [locations],
  )
  const [cabinetId, setCabinetId] = useState('')
  const [typeId, setTypeId] = useState('')
  const [labels, setLabels] = useState<LabelItem[]>([])
  const [busy, setBusy] = useState(false)

  const selectedType = types.find((tp) => tp.id === typeId)
  const grid = selectedType ?? settings?.label_grid ?? { w_mm: 38, h_mm: 21, cols: 5, rows: 13 }

  async function generate() {
    const cab = cabinets.find((c) => c.id === cabinetId)
    if (!cab) return
    setBusy(true)
    const drawers = locations
      .filter((l) => l.type === 'drawer' && l.path.startsWith(cab.path + '/'))
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    const out: LabelItem[] = []
    for (const d of drawers) {
      const url = locationUrl(d.code, settings?.qr_base_url)
      out.push({ code: d.code, dataUrl: await qrDataUrl(url, 160) })
    }
    setLabels(out)
    setBusy(false)
  }

  return (
    <>
      <AppHeader title={t('labels.title')} />
      <Container>
        <div className="no-print card card-pad mb-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="cab">{t('labels.cabinet')}</label>
              <select id="cab" value={cabinetId} onChange={(e) => setCabinetId(e.target.value)} className="select">
                <option value="">—</option>
                {cabinets.map((c) => (
                  <option key={c.id} value={c.id}>{c.code} — {c.name ?? c.path}</option>
                ))}
              </select>
            </div>
            {types.length > 0 && (
              <div>
                <label className="field-label" htmlFor="ltype">{t('labels.type')}</label>
                <select id="ltype" value={typeId} onChange={(e) => setTypeId(e.target.value)} className="select">
                  <option value="">{t('labels.default_type')}</option>
                  {types.map((tp) => (
                    <option key={tp.id} value={tp.id}>{tp.name} ({tp.w_mm}×{tp.h_mm}mm){tp.qty ? ` · ${tp.qty} adet` : ''}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="mt-3 flex gap-2">
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
