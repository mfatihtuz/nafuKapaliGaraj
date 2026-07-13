import { useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { api, ApiError } from '../../sync/api'
import type { LabelType } from '../../db/types'
import { uuidv7 } from '../../lib/uuid'
import { useT } from '../../i18n'
import { useToast } from '../Toast'
import { IconPlus, IconTrash } from '../icons'

export function LabelsSection() {
  const { t } = useT()
  const { auth, refresh } = useAuth()
  const toast = useToast()
  const s = auth?.tenant.settings
  const grid = s?.label_grid ?? { w_mm: 38, h_mm: 21, cols: 5, rows: 13 }

  const [w, setW] = useState(String(grid.w_mm))
  const [h, setH] = useState(String(grid.h_mm))
  const [cols, setCols] = useState(String(grid.cols))
  const [rows, setRows] = useState(String(grid.rows))
  const [qrBase, setQrBase] = useState(s?.qr_base_url ?? '')
  const [types, setTypes] = useState<LabelType[]>(s?.label_types ?? [])
  const [busy, setBusy] = useState(false)

  function patchType(id: string, patch: Partial<LabelType>) {
    setTypes((ts) => ts.map((t2) => (t2.id === id ? { ...t2, ...patch } : t2)))
  }
  function addType() {
    setTypes((ts) => [...ts, { id: uuidv7(), name: '', w_mm: Number(w) || 38, h_mm: Number(h) || 21, cols: Number(cols) || 5, rows: Number(rows) || 13, qty: 0 }])
  }

  async function save() {
    setBusy(true)
    try {
      await api.updateOrgSettings({
        label_grid: { w_mm: Number(w), h_mm: Number(h), cols: Number(cols), rows: Number(rows) },
        qr_base_url: qrBase.trim(),
        label_types: types.filter((tp) => tp.name.trim() !== ''),
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
    <div className="space-y-4">
      {/* Varsayılan boyut */}
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
      </div>

      {/* Etiket tipleri + adet */}
      <div className="card card-pad">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-brand-800">{t('settings.labels_cfg.types')}</h2>
            <p className="text-sm text-brand-400">{t('settings.labels_cfg.types_hint')}</p>
          </div>
          <button onClick={addType} className="btn-outline"><IconPlus size={16} /> {t('settings.labels_cfg.add_type')}</button>
        </div>

        <div className="space-y-2">
          {types.map((tp) => (
            <div key={tp.id} className="rounded-lg border border-line bg-canvas p-3">
              <div className="flex items-center gap-2">
                <input className="input h-9 flex-1" placeholder={t('settings.labels_cfg.type_name')} value={tp.name}
                  onChange={(e) => patchType(tp.id, { name: e.target.value })} />
                <button onClick={() => setTypes((ts) => ts.filter((x) => x.id !== tp.id))} className="btn-icon h-9 w-9 text-brand-300 hover:bg-red-50 hover:text-red-600">
                  <IconTrash size={16} />
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                <label className="text-xs text-brand-400">{t('settings.labels_cfg.w')}
                  <input className="input mt-0.5 h-9" type="number" value={tp.w_mm} onChange={(e) => patchType(tp.id, { w_mm: Number(e.target.value) })} />
                </label>
                <label className="text-xs text-brand-400">{t('settings.labels_cfg.h')}
                  <input className="input mt-0.5 h-9" type="number" value={tp.h_mm} onChange={(e) => patchType(tp.id, { h_mm: Number(e.target.value) })} />
                </label>
                <label className="text-xs text-brand-400">{t('settings.labels_cfg.cols')}
                  <input className="input mt-0.5 h-9" type="number" value={tp.cols} onChange={(e) => patchType(tp.id, { cols: Number(e.target.value) })} />
                </label>
                <label className="text-xs text-brand-400">{t('settings.labels_cfg.rows')}
                  <input className="input mt-0.5 h-9" type="number" value={tp.rows} onChange={(e) => patchType(tp.id, { rows: Number(e.target.value) })} />
                </label>
                <label className="text-xs font-semibold text-brand-600">{t('settings.labels_cfg.qty')}
                  <input className="input mt-0.5 h-9 font-semibold" type="number" value={tp.qty} onChange={(e) => patchType(tp.id, { qty: Number(e.target.value) })} />
                </label>
              </div>
            </div>
          ))}
          {types.length === 0 && <p className="py-4 text-center text-sm text-brand-300">{t('settings.labels_cfg.no_types')}</p>}
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={() => void save()} disabled={busy} className="btn-primary">{t('common.save')}</button>
      </div>
    </div>
  )
}
