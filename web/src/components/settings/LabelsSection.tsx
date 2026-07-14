import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { api, ApiError } from '../../sync/api'
import { useLocations } from '../../db/queries'
import type { LabelType } from '../../db/types'
import { DEFAULT_LABEL_TYPES, DEFAULT_LABEL_GRID } from '../../lib/labelDefaults'
import { computeGrid } from '../../lib/labelSheet'
import { uuidv7 } from '../../lib/uuid'
import { useT } from '../../i18n'
import { useToast } from '../Toast'
import { IconPlus, IconTrash } from '../icons'

/** Hiç ayarlanmamış (null/undefined) ise varsayılanları göster; boş dizi ([]) kullanıcının
 *  bilinçli "tip yok" tercihidir — varsayılanlarla EZİLMEZ. */
function resolveTypes(st: LabelType[] | null | undefined): LabelType[] {
  return st == null ? DEFAULT_LABEL_TYPES : st
}

/** Kaydetmeden önce sütun/satırı En×Boy'dan A4'e göre türet (elle girilmez). */
function withGrid(tp: LabelType): LabelType {
  const g = computeGrid(tp.w_mm, tp.h_mm)
  return { ...tp, cols: g.cols, rows: g.rows }
}

export function LabelsSection() {
  const { t } = useT()
  const { auth, refresh } = useAuth()
  const toast = useToast()
  const s = auth?.tenant.settings
  const grid = s?.label_grid ?? DEFAULT_LABEL_GRID

  const [w, setW] = useState(String(grid.w_mm))
  const [h, setH] = useState(String(grid.h_mm))
  const [qrBase, setQrBase] = useState(s?.qr_base_url ?? '')
  const [types, setTypes] = useState<LabelType[]>(resolveTypes(s?.label_types))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  // Dolaplar — tip ↔ dolap bağı için (Etiket Yazdır'da dolap seçilince tip otomatik gelir).
  const locations = useLocations()
  const cabinets = useMemo(
    () => locations.filter((l) => l.type === 'cabinet').sort((a, b) => a.sort_order - b.sort_order),
    [locations],
  )
  // Kaydet sırasında gelen düzenlemeleri kaybetmemek için düzenleme sayacı.
  const editSeq = useRef(0)
  function touch() { editSeq.current++; setDirty(true) }

  // Açılışta sunucudan en güncel ayarları çek (önbellekteki kimlik eski olabilir).
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sunucu ayarları değişince (refresh sonrası) ve kullanıcı düzenleme yapmadıysa eşitle.
  const serverKey = JSON.stringify({ g: s?.label_grid, q: s?.qr_base_url, t: s?.label_types })
  useEffect(() => {
    if (dirty) return
    const g = s?.label_grid ?? DEFAULT_LABEL_GRID
    setW(String(g.w_mm)); setH(String(g.h_mm))
    setQrBase(s?.qr_base_url ?? '')
    setTypes(resolveTypes(s?.label_types))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey])

  function patchType(id: string, patch: Partial<LabelType>) {
    touch()
    setTypes((ts) => ts.map((t2) => (t2.id === id ? { ...t2, ...patch } : t2)))
  }
  function addType() {
    touch()
    setTypes((ts) => [...ts, { id: uuidv7(), name: '', w_mm: Number(w) || 38, h_mm: Number(h) || 21, cols: 5, rows: 13, qty: 0 }])
  }
  function removeType(id: string) {
    touch()
    setTypes((ts) => ts.filter((x) => x.id !== id))
  }
  function loadDefaults() {
    touch()
    setTypes(DEFAULT_LABEL_TYPES)
    toast.show(t('settings.labels_cfg.defaults_loaded'), 'info')
  }

  async function save() {
    setBusy(true)
    const seq = editSeq.current
    try {
      const g = computeGrid(Number(w), Number(h))
      await api.updateOrgSettings({
        label_grid: { w_mm: Number(w), h_mm: Number(h), cols: g.cols, rows: g.rows },
        qr_base_url: qrBase.trim(),
        label_types: types.filter((tp) => tp.name.trim() !== '').map(withGrid),
      })
      // Kaydet sırasında yeni düzenleme gelmediyse temizle (yoksa düzenleme korunur).
      if (editSeq.current === seq) setDirty(false)
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
      <input className="input" type="number" inputMode="numeric" value={val}
        onChange={(e) => { touch(); set(e.target.value) }} />
    </div>
  )

  // Üst kartın (varsayılan sayfa) türetilmiş ızgarası
  const defGrid = computeGrid(Number(w), Number(h))

  return (
    <div className="space-y-4">
      {/* Varsayılan boyut */}
      <div className="card card-pad">
        <h2 className="mb-1 text-base font-semibold text-brand-800">{t('settings.labels_cfg.title')}</h2>
        <p className="mb-4 text-sm text-brand-400">{t('settings.labels_cfg.grid_explain')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {num(t('settings.labels_cfg.w'), w, setW)}
          {num(t('settings.labels_cfg.h'), h, setH)}
          <div className="sm:col-span-2 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2.5 text-sm">
            <span className="font-semibold text-brand-700">{t('settings.labels_cfg.a4_fit')}:</span>
            <span className="tabular-nums text-brand-800">
              {defGrid.cols} × {defGrid.rows} = {defGrid.cols * defGrid.rows} {t('settings.labels_cfg.per_page')}
            </span>
          </div>
          <div className="sm:col-span-2">
            <label className="field-label">{t('settings.labels_cfg.qr_base')}</label>
            <input className="input font-mono text-sm" value={qrBase}
              onChange={(e) => { touch(); setQrBase(e.target.value) }} autoCapitalize="none" />
            <p className="field-hint">{t('settings.labels_cfg.qr_explain')}</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-brand-300">{t('settings.labels_cfg.print_scale')}</p>
      </div>

      {/* Etiket tipleri + adet */}
      <div className="card card-pad">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-brand-800">{t('settings.labels_cfg.types')}</h2>
            <p className="text-sm text-brand-400">{t('settings.labels_cfg.types_hint')}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={loadDefaults} className="btn-ghost text-sm">{t('settings.labels_cfg.load_defaults')}</button>
            <button onClick={addType} className="btn-outline"><IconPlus size={16} /> {t('settings.labels_cfg.add_type')}</button>
          </div>
        </div>

        <div className="space-y-2">
          {types.map((tp) => {
            const g = computeGrid(tp.w_mm, tp.h_mm)
            return (
              <div key={tp.id} className="rounded-lg border border-line bg-canvas p-3">
                <div className="flex items-center gap-2">
                  <input className="input h-9 flex-1" placeholder={t('settings.labels_cfg.type_name')} value={tp.name}
                    onChange={(e) => patchType(tp.id, { name: e.target.value })} />
                  <button onClick={() => removeType(tp.id)} title={t('common.delete')} aria-label={t('common.delete')} className="btn-icon h-9 w-9 text-brand-300 hover:bg-red-50 hover:text-red-600">
                    <IconTrash size={16} />
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <label className="text-xs text-brand-400">{t('settings.labels_cfg.w')}
                    <input className="input mt-0.5 h-9" type="number" value={tp.w_mm} onChange={(e) => patchType(tp.id, { w_mm: Number(e.target.value) })} />
                  </label>
                  <label className="text-xs text-brand-400">{t('settings.labels_cfg.h')}
                    <input className="input mt-0.5 h-9" type="number" value={tp.h_mm} onChange={(e) => patchType(tp.id, { h_mm: Number(e.target.value) })} />
                  </label>
                  <label className="text-xs font-semibold text-brand-600">{t('settings.labels_cfg.qty')}
                    <input className="input mt-0.5 h-9 font-semibold" type="number" value={tp.qty} onChange={(e) => patchType(tp.id, { qty: Number(e.target.value) })} />
                  </label>
                  <div className="text-xs text-brand-400">{t('settings.labels_cfg.a4_fit')}
                    <div className="mt-0.5 flex h-9 items-center rounded-lg bg-brand-50 px-2 tabular-nums text-brand-700">
                      {g.cols}×{g.rows} · {g.cols * g.rows}/{t('settings.labels_cfg.page')}
                    </div>
                  </div>
                </div>

                {/* Tip ↔ dolap bağı: bu tip hangi dolaplarda kullanılıyor?
                    Etiket Yazdır'da dolap seçilince bağlı tip otomatik seçilir. */}
                {cabinets.length > 0 && (
                  <div className="mt-2">
                    <div className="mb-1 text-xs text-brand-400">{t('settings.labels_cfg.cabinets')}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {cabinets.map((cab) => {
                        const active = (tp.cabinets ?? []).includes(cab.id)
                        return (
                          <button
                            key={cab.id}
                            type="button"
                            onClick={() => {
                              const cur = new Set(tp.cabinets ?? [])
                              if (active) cur.delete(cab.id)
                              else cur.add(cab.id)
                              patchType(tp.id, { cabinets: [...cur] })
                            }}
                            className={`chip px-2.5 py-1 text-xs transition-colors ${
                              active ? 'bg-brand text-white' : 'bg-brand-50 text-brand-500 hover:bg-brand-100'
                            }`}
                          >
                            {cab.code}{cab.name ? ` · ${cab.name}` : ''}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {types.length === 0 && <p className="py-4 text-center text-sm text-brand-300">{t('settings.labels_cfg.no_types')}</p>}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        {dirty && <span className="text-xs text-accent-700">{t('settings.labels_cfg.unsaved')}</span>}
        <button onClick={() => void save()} disabled={busy} className="btn-primary">{t('common.save')}</button>
      </div>
    </div>
  )
}
