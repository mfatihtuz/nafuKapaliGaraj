import { useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { api, ApiError } from '../../sync/api'
import { useT } from '../../i18n'
import { useToast } from '../Toast'

export function LabelsSection() {
  const { t } = useT()
  const { auth, refresh } = useAuth()
  const toast = useToast()
  const grid = auth?.tenant.settings?.label_grid ?? { w_mm: 38, h_mm: 21, cols: 5, rows: 13 }
  const [w, setW] = useState(String(grid.w_mm))
  const [h, setH] = useState(String(grid.h_mm))
  const [cols, setCols] = useState(String(grid.cols))
  const [rows, setRows] = useState(String(grid.rows))
  const [qrBase, setQrBase] = useState(auth?.tenant.settings?.qr_base_url ?? '')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await api.updateOrgSettings({
        label_grid: { w_mm: Number(w), h_mm: Number(h), cols: Number(cols), rows: Number(rows) },
        qr_base_url: qrBase.trim(),
      })
      await refresh()
      toast.show(t('settings.labels_cfg.saved'), 'success')
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : 'Hata', 'error')
    } finally {
      setBusy(false)
    }
  }

  const num = (label: string, val: string, set: (v: string) => void) => (
    <div>
      <label className="field-label">{label}</label>
      <input className="input" type="number" inputMode="numeric" value={val} onChange={(e) => set(e.target.value)} />
    </div>
  )

  return (
    <div className="card card-pad">
      <h2 className="mb-4 text-base font-semibold text-brand-800">{t('settings.labels_cfg.title')}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {num(t('settings.labels_cfg.w'), w, setW)}
        {num(t('settings.labels_cfg.h'), h, setH)}
        {num(t('settings.labels_cfg.cols'), cols, setCols)}
        {num(t('settings.labels_cfg.rows'), rows, setRows)}
        <div className="sm:col-span-2">
          <label className="field-label">{t('settings.labels_cfg.qr_base')}</label>
          <input className="input font-mono text-sm" value={qrBase} onChange={(e) => setQrBase(e.target.value)} autoCapitalize="none" />
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <button onClick={() => void save()} disabled={busy} className="btn-primary">{t('common.save')}</button>
      </div>
    </div>
  )
}
