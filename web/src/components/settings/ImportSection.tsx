import { useMemo, useRef, useState } from 'react'
import { useCategories, useLocations, useParts } from '../../db/queries'
import { buildImportPlan, TEMPLATE_HEADERS, type ImportPlan, type ResolvedRow } from '../../lib/partImport'
import { toCsvRow } from '../../lib/csv'
import { buildTags } from '../../lib/sku'
import { importPartsBulk, type ImportItem } from '../../db/actions'
import { uuidv7 } from '../../lib/uuid'
import type { Category, Part } from '../../db/types'
import { useT } from '../../i18n'
import { useToast } from '../Toast'
import { IconUpload, IconDatabase } from '../icons'

/**
 * CSV / toplu parça içe aktarma (Ayarlar). Yapıştır veya .csv yükle → önizle
 * (geçerli/hatalı satırlar) → yalnız geçerlileri içe aktar. Offline-first:
 * her satır normal parça oluşturma yolundan geçer (savePart + başlangıç stoğu).
 */
export function ImportSection({ canWrite }: { canWrite: boolean }) {
  const { t } = useT()
  const toast = useToast()
  const categories = useCategories()
  const locations = useLocations()
  const parts = useParts()
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [busy, setBusy] = useState(false)

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const existingSkus = useMemo(
    () => new Set(parts.filter((p) => !p.deleted_at).map((p) => p.sku).filter(Boolean)),
    [parts],
  )

  function analyze(src: string) {
    setText(src)
    if (src.trim() === '') { setPlan(null); return }
    setPlan(buildImportPlan(src, { categories, locations, existingSkus }))
  }

  function onFile(f: File | undefined) {
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => analyze(String(reader.result ?? ''))
    reader.readAsText(f, 'utf-8')
  }

  function downloadTemplate() {
    const sample = [
      TEMPLATE_HEADERS,
      ['10K Direnç 0805', 'Direnç', '', 'miktarlı', 'adet', '50', '200', '', 'S1-01', 'Yageo', 'RC0805FR-0710KL', ''],
      ['Lehim teli 0.8mm', 'Sarf', '', 'doluluk', '', '', '', 'dolu', 'S1-02', '', '', 'kurşunsuz'],
      ['Yankeski', 'El aleti', 'ALET-YANKESKI', 'takipsiz', '', '', '', '', 'T1', '', '', ''],
    ]
    const csv = sample.map((r) => toCsvRow(r, ';')).join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'depo-parca-sablon.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function toItem(r: ResolvedRow): ImportItem {
    const cat: Category | undefined = r.categoryId ? catById.get(r.categoryId) : undefined
    const part: Part = {
      id: uuidv7(),
      category_id: r.categoryId,
      sku: r.sku,
      name: r.name,
      mpn: r.mpn,
      manufacturer: r.manufacturer,
      attributes: null,
      tags: buildTags(r.name, null, cat, r.manufacturer, r.mpn),
      count_mode: r.count_mode,
      abc_class: 'C',
      min_qty: r.min_qty,
      unit: r.count_mode === 'exact' ? r.unit : 'adet',
      datasheet_url: r.datasheet_url,
      photo_id: null,
      notes: r.notes,
      updated_at: '', // toplu yazıcıda damgalanır
      deleted_at: null,
    }
    let stock: ImportItem['stock']
    if (r.locationId) {
      if (r.count_mode === 'level' && r.level) stock = { locationId: r.locationId, level: r.level }
      else if (r.count_mode === 'exact' && r.qty && r.qty > 0) stock = { locationId: r.locationId, delta: r.qty }
      else if (r.count_mode === 'unmanaged') stock = { locationId: r.locationId, delta: 1 }
    }
    return { part, stock }
  }

  async function doImport() {
    if (!plan || plan.okCount === 0) return
    setBusy(true)
    try {
      const items = plan.rows.filter((r) => r.resolved).map((r) => toItem(r.resolved!))
      const n = await importPartsBulk(items)
      toast.show(t('settings.import.done', { n }), 'success')
      setText(''); setPlan(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch {
      toast.show(t('settings.import.fail'), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!canWrite) {
    return (
      <div className="card card-pad">
        <h2 className="mb-1 text-base font-semibold text-brand-800">{t('settings.sections.import')}</h2>
        <p className="text-sm text-brand-400">{t('perm.no_add')}</p>
      </div>
    )
  }

  const previewRows = plan ? plan.rows.slice(0, 60) : []

  return (
    <div className="space-y-4">
      <div className="card card-pad">
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-brand-800">
          <IconUpload size={18} /> {t('settings.import.title')}
        </h2>
        <p className="mb-3 text-sm text-brand-400">{t('settings.import.intro')}</p>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => fileRef.current?.click()} className="btn-ghost text-sm">
            <IconUpload size={16} /> {t('settings.import.pick_file')}
          </button>
          <button onClick={downloadTemplate} className="btn-ghost text-sm">
            <IconDatabase size={16} /> {t('settings.import.template')}
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])} />
        </div>

        <textarea
          value={text}
          onChange={(e) => analyze(e.target.value)}
          placeholder={t('settings.import.placeholder')}
          rows={6}
          className="mt-3 w-full rounded-xl border border-line bg-canvas p-3 font-mono text-xs text-brand-700"
          spellCheck={false}
        />
        <p className="mt-1 text-xs text-brand-300">{t('settings.import.hint')}</p>
      </div>

      {plan && (
        <div className="card card-pad">
          {plan.unknownHeaders.length > 0 && (
            <p className="mb-2 text-xs text-amber-700">
              {t('settings.import.unknown_cols', { cols: plan.unknownHeaders.join(', ') })}
            </p>
          )}
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            <span className="chip bg-green-50 font-semibold text-green-700">{t('settings.import.ok_count', { n: plan.okCount })}</span>
            {plan.errorCount > 0 && (
              <span className="chip bg-red-50 font-semibold text-red-700">{t('settings.import.err_count', { n: plan.errorCount })}</span>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left text-xs">
              <thead className="bg-brand-50 text-brand-500">
                <tr>
                  <th className="p-2">#</th>
                  <th className="p-2">{t('settings.import.col_name')}</th>
                  <th className="p-2">SKU</th>
                  <th className="p-2">{t('common.category')}</th>
                  <th className="p-2">{t('settings.import.col_stock')}</th>
                  <th className="p-2">{t('settings.import.col_status')}</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => (
                  <tr key={row.line} className="border-t border-line align-top">
                    <td className="p-2 text-brand-300">{row.line}</td>
                    <td className="p-2 font-medium text-brand-700">{row.resolved?.name ?? row.raw.join(' ').slice(0, 24)}</td>
                    <td className="p-2 font-mono text-brand-500">
                      {row.resolved?.sku}
                      {row.resolved?.skuGenerated && <span className="ml-1 text-[10px] text-amber-600">({t('settings.import.auto')})</span>}
                    </td>
                    <td className="p-2 text-brand-500">{row.resolved?.categoryLabel ?? '—'}</td>
                    <td className="p-2 text-brand-500 tabular-nums">
                      {row.resolved?.locationCode
                        ? `${row.resolved.count_mode === 'level' ? (row.resolved.level ?? '') : (row.resolved.qty ?? (row.resolved.count_mode === 'unmanaged' ? '✓' : ''))} → ${row.resolved.locationCode}`
                        : '—'}
                    </td>
                    <td className="p-2">
                      {row.issues.length === 0
                        ? <span className="text-green-600">✓</span>
                        : <span className="text-red-600">{row.issues.join('; ')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {plan.rows.length > previewRows.length && (
            <p className="mt-2 text-xs text-brand-300">{t('settings.import.more', { n: plan.rows.length - previewRows.length })}</p>
          )}

          <button onClick={() => void doImport()} disabled={busy || plan.okCount === 0}
            className="btn-navy mt-4 w-full disabled:opacity-50">
            {busy ? t('settings.import.importing') : t('settings.import.action', { n: plan.okCount })}
          </button>
        </div>
      )}
    </div>
  )
}
