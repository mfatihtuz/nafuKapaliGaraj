import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AppHeader, Container } from '../components/Layout'
import { useCategories, useLocations } from '../db/queries'
import { AttributeForm } from '../components/AttributeForm'
import type { Category, Part, PartAttributes, StockLevel } from '../db/types'
import { buildSku, skuKeys } from '../lib/sku'
import { normalize } from '../lib/normalize'
import { uuidv7 } from '../lib/uuid'
import { db } from '../db/dexie'
import { savePart, moveStock, setLevel } from '../db/actions'
import { LEVEL_LABEL } from '../lib/format'
import { useT } from '../i18n'
import { useToast } from '../components/Toast'
import { IconCheck } from '../components/icons'

const LEVELS: StockLevel[] = ['full', 'low', 'empty']

function buildTags(name: string, attrs: PartAttributes, cat: Category | undefined): string {
  const parts = [name, cat?.name_tr ?? '', cat?.name_en ?? '', ...Object.values(attrs).map(String)]
  const tokens = new Set<string>()
  for (const p of parts) {
    for (const w of normalize(p).split(/\s+/)) if (w) tokens.add(w)
  }
  return [...tokens].join(',')
}

export function Intake() {
  const { t } = useT()
  const toast = useToast()
  const [searchParams] = useSearchParams()
  const categories = useCategories()
  const locations = useLocations()

  const selectable = useMemo(
    () => categories.filter((c) => c.sku_template),
    [categories],
  )

  const [catId, setCatId] = useState<string>('')
  const [attrs, setAttrs] = useState<PartAttributes>({})
  const [name, setName] = useState('')
  const [locCode, setLocCode] = useState<string>(searchParams.get('location') ?? '')
  const [qty, setQty] = useState('')
  const [level, setLvl] = useState<StockLevel | null>(null)
  const [serial, setSerial] = useState(true)
  const [busy, setBusy] = useState(false)

  const category = categories.find((c) => c.id === catId)
  const sku = category ? buildSku(category.sku_template, attrs) : ''
  const locationMatch = locations.find((l) => l.code.toUpperCase() === locCode.trim().toUpperCase())
  const mode = category?.default_count_mode ?? 'exact'

  // Kaydetme için zorunlu alanlar: SKU şablonundaki tüm {key}'ler + required öznitelikler dolu olmalı.
  const requiredKeys = category
    ? new Set<string>([
        ...skuKeys(category.sku_template),
        ...(category.attribute_schema ?? []).filter((d) => d.required).map((d) => d.key),
      ])
    : new Set<string>()
  const attrsComplete = [...requiredKeys].every((k) => {
    const v = attrs[k]
    return v !== undefined && v !== null && String(v).trim() !== ''
  })
  const levelOk = mode !== 'level' || level !== null

  function resetPart() {
    setAttrs({})
    setName('')
    setQty('')
    setLvl(null)
    if (!serial) setCatId('')
  }

  async function onSave() {
    if (!category || !locationMatch || !sku) return
    setBusy(true)
    try {
      // Mükerrer kontrolü
      const existing = await db.parts.where('sku').equals(sku).first()
      const finalName = name.trim() || `${category.name_tr} ${Object.values(attrs).filter(Boolean).join(' ')}`.trim()

      let partId: string
      if (existing && !existing.deleted_at) {
        partId = existing.id
        toast.show(t('intake.add_to_existing'), 'info')
      } else {
        const part: Part = {
          id: existing?.id ?? uuidv7(),
          category_id: category.id,
          sku,
          name: finalName,
          mpn: null,
          manufacturer: null,
          attributes: attrs,
          tags: buildTags(finalName, attrs, category),
          count_mode: mode,
          abc_class: 'C',
          min_qty: null,
          unit: 'adet',
          datasheet_url: null,
          photo_id: null,
          notes: null,
          updated_at: '',
          deleted_at: null,
        }
        partId = await savePart(part)
      }

      // Başlangıç stoğu
      if (mode === 'exact') {
        const n = Number(qty)
        await moveStock({ partId, locationId: locationMatch.id, delta: Number.isFinite(n) ? n : 0, reason: 'initial' })
      } else if (mode === 'level' && level) {
        await setLevel(partId, locationMatch.id, level)
      } else if (mode === 'unmanaged') {
        // unmanaged: konum ilişkisini kur (delta 0)
        await moveStock({ partId, locationId: locationMatch.id, delta: 0, reason: 'initial' })
      }

      toast.show(t('intake.saved', { code: sku }), 'success')
      resetPart()
    } finally {
      setBusy(false)
    }
  }

  const canSave = !!category && !!locationMatch && !!sku && attrsComplete && levelOk && !busy

  return (
    <>
      <AppHeader />
      <Container>
        <h1 className="mb-3 text-lg font-bold text-brand-800">{t('intake.title')}</h1>

        {/* 1. Kategori */}
        <div className="card mb-3 p-4">
          <div className="field-label">{t('intake.choose_category')}</div>
          <div className="flex flex-wrap gap-1.5">
            {selectable.map((c) => (
              <button
                key={c.id}
                onClick={() => { setCatId(c.id); setAttrs({}); setLvl(null); setQty('') }}
                className={`chip min-h-[40px] px-3 ${
                  catId === c.id ? 'bg-accent text-brand-900' : 'bg-brand-50 text-brand-600'
                }`}
              >
                {c.name_tr}
              </button>
            ))}
          </div>
        </div>

        {category && (
          <>
            {/* 2. Öznitelikler + SKU */}
            <div className="card mb-3 p-4">
              {category.attribute_schema && category.attribute_schema.length > 0 && (
                <div className="mb-3">
                  <div className="field-label">{t('intake.attributes')}</div>
                  <AttributeForm
                    schema={category.attribute_schema}
                    values={attrs}
                    onChange={(k, v) => setAttrs((a) => ({ ...a, [k]: v }))}
                  />
                </div>
              )}
              <div className="rounded-xl bg-brand-50 px-3 py-2">
                <span className="text-xs text-brand-400">{t('intake.code_preview')}: </span>
                <span className="font-mono font-bold text-brand-800">{sku || '—'}</span>
              </div>
              <div className="mt-3">
                <label className="field-label" htmlFor="pname">{t('intake.name_auto')}</label>
                <input id="pname" className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </div>

            {/* 3. Konum */}
            <div className="card mb-3 p-4">
              <label className="field-label" htmlFor="loc">{t('intake.location')}</label>
              <input
                id="loc"
                list="loc-codes"
                value={locCode}
                onChange={(e) => setLocCode(e.target.value)}
                placeholder={t('intake.location_placeholder')}
                className="input font-mono uppercase"
                autoCapitalize="characters"
              />
              <datalist id="loc-codes">
                {locations.map((l) => <option key={l.id} value={l.code}>{l.name ?? l.path}</option>)}
              </datalist>
              {locCode.trim() && !locationMatch && (
                <p className="mt-1 text-xs text-red-600">{t('scan.not_found', { code: locCode })}</p>
              )}
              {locationMatch && (
                <p className="mt-1 text-xs text-green-700">{locationMatch.path}</p>
              )}
            </div>

            {/* 4. Miktar / Seviye */}
            <div className="card mb-3 p-4">
              {mode === 'exact' && (
                <div>
                  <label className="field-label" htmlFor="qty">{t('intake.qty')}</label>
                  <input
                    id="qty" type="number" inputMode="numeric" value={qty}
                    onChange={(e) => setQty(e.target.value)} className="input" placeholder="0"
                  />
                </div>
              )}
              {mode === 'level' && (
                <div>
                  <div className="field-label">{t('intake.level')}</div>
                  <div className="flex gap-1.5">
                    {LEVELS.map((lvl) => (
                      <button
                        key={lvl}
                        onClick={() => setLvl(lvl)}
                        className={`btn min-h-touch flex-1 text-sm font-bold ${
                          level === lvl ? 'bg-brand text-white' : 'bg-brand-50 text-brand-500'
                        }`}
                      >
                        {LEVEL_LABEL[lvl]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {mode === 'unmanaged' && (
                <p className="text-sm text-brand-400">{t('count_mode.unmanaged_hint')}</p>
              )}
            </div>

            <label className="mb-3 flex items-center gap-2 px-1 text-sm text-brand-500">
              <input type="checkbox" checked={serial} onChange={(e) => setSerial(e.target.checked)} />
              {t('intake.serial_mode')}
            </label>

            <button onClick={() => void onSave()} disabled={!canSave} className="btn-primary w-full">
              <IconCheck size={20} />
              {serial ? t('intake.save_next') : t('intake.save')}
            </button>
          </>
        )}
      </Container>
    </>
  )
}
