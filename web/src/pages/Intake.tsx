import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AppHeader, Container } from '../components/Layout'
import { useCategories, useLocations } from '../db/queries'
import { AttributeForm } from '../components/AttributeForm'
import type { Category, Location, Part, PartAttributes, StockLevel } from '../db/types'
import { buildSku, autoName } from '../lib/sku'
import { UNITS } from '../lib/units'
import { normalize } from '../lib/normalize'
import { uuidv7 } from '../lib/uuid'
import { db } from '../db/dexie'
import { savePart, moveStock, setLevel } from '../db/actions'
import { LEVEL_LABEL } from '../lib/format'
import { useT } from '../i18n'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { IconCheck, IconChevronRight, IconBack, IconSearch, IconFolder } from '../components/icons'

const LEVELS: StockLevel[] = ['full', 'low', 'empty']

function buildTags(name: string, attrs: PartAttributes, cat: Category | undefined): string {
  const parts = [name, cat?.name_tr ?? '', cat?.name_en ?? '', ...Object.values(attrs).map(String)]
  const tokens = new Set<string>()
  for (const p of parts) for (const w of normalize(p).split(/\s+/)) if (w) tokens.add(w)
  return [...tokens].join(',')
}

function Stepper({ step, labels }: { step: number; labels: string[] }) {
  return (
    <div className="mb-5 flex items-center gap-2">
      {labels.map((label, i) => {
        const n = i + 1
        const done = n < step
        const active = n === step
        return (
          <div key={label} className="flex flex-1 items-center gap-2">
            <div className={`flex items-center gap-2 ${active || done ? 'text-brand-800' : 'text-brand-300'}`}>
              <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${
                active ? 'bg-accent text-brand-900' : done ? 'bg-brand-700 text-white' : 'bg-mist text-brand-400'
              }`}>
                {done ? <IconCheck size={14} /> : n}
              </span>
              <span className="hidden text-sm font-medium sm:inline">{label}</span>
            </div>
            {i < labels.length - 1 && <div className={`h-px flex-1 ${done ? 'bg-brand-700' : 'bg-line'}`} />}
          </div>
        )
      })}
    </div>
  )
}

export function Intake() {
  const { t } = useT()
  const { canWrite } = useAuth()
  const toast = useToast()
  const [searchParams] = useSearchParams()
  const categories = useCategories()
  const locations = useLocations()

  const [step, setStep] = useState(1)
  const [catId, setCatId] = useState('')
  const [catQuery, setCatQuery] = useState('')
  const [attrs, setAttrs] = useState<PartAttributes>({})
  const [name, setName] = useState('')
  const [locCode, setLocCode] = useState(searchParams.get('location') ?? '')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('adet')
  const [level, setLvl] = useState<StockLevel | null>(null)
  const [serial, setSerial] = useState(true)
  const [busy, setBusy] = useState(false)

  const selectable = useMemo(() => categories.filter((c) => c.sku_template), [categories])
  const groups = useMemo(() => {
    const q = normalize(catQuery)
    const map = new Map<string, { name: string; items: Category[] }>()
    for (const c of selectable) {
      if (q && !normalize(c.name_tr).includes(q) && !normalize(c.code).includes(q)) continue
      const parent = categories.find((p) => p.id === c.parent_id)
      const key = parent?.id ?? 'root'
      if (!map.has(key)) map.set(key, { name: parent?.name_tr ?? 'Diğer', items: [] })
      map.get(key)!.items.push(c)
    }
    return [...map.values()]
  }, [selectable, categories, catQuery])

  const category = categories.find((c) => c.id === catId)
  const sku = category ? buildSku(category.sku_template, attrs) : ''
  const mode = category?.default_count_mode ?? 'exact'

  // Parça yalnızca YAPRAK konuma eklenir (alt konumu olmayan çekmece/göz).
  // Dolap/modül gibi gruplar depolama hedefi değildir — öneri listesinden çıkarılır.
  const childParentIds = useMemo(
    () => new Set(locations.filter((l) => l.parent_id).map((l) => l.parent_id as string)),
    [locations],
  )
  const isLeaf = (l: Location) => !childParentIds.has(l.id)
  const storableLocations = useMemo(() => locations.filter(isLeaf), [locations, childParentIds])

  const typedCode = locCode.trim().toUpperCase()
  const exactLoc = locations.find((l) => l.code.toUpperCase() === typedCode)
  const locationMatch = exactLoc && isLeaf(exactLoc) ? exactLoc : undefined
  const containerMatch = exactLoc && !isLeaf(exactLoc) ? exactLoc : undefined

  // Yalnızca "zorunlu" işaretli alanlar mecburi. "Koda girer" bir alanı zorunlu KILMAZ;
  // boş bırakılırsa SKU'dan o parça düşer (buildSku ayraçları temizler).
  const requiredKeys = category
    ? new Set<string>((category.attribute_schema ?? []).filter((d) => d.required).map((d) => d.key))
    : new Set<string>()
  const attrsComplete = [...requiredKeys].every((k) => {
    const v = attrs[k]
    return v !== undefined && v !== null && String(v).trim() !== ''
  })
  const levelOk = mode !== 'level' || level !== null
  // Miktarlı modda miktar zorunlu ve > 0 — yoksa parça 0 stokla oluşur,
  // "tükenmiş" sayılıp listelerden gizlenir ve kullanıcı parçayı "kayboldu" sanır.
  const qtyOk = mode !== 'exact' || (qty.trim() !== '' && Number(qty) > 0)
  const canSave = !!category && !!locationMatch && !!sku && attrsComplete && levelOk && qtyOk && !busy

  function pickCategory(id: string) {
    setCatId(id)
    setAttrs({})
    setLvl(null)
    setQty('')
    setStep(2)
  }

  async function onSave() {
    if (!category || !locationMatch || !sku) return
    setBusy(true)
    try {
      const existing = await db.parts.where('sku').equals(sku).first()
      const finalName = name.trim() || autoName(category, attrs)
      let partId: string
      if (existing && !existing.deleted_at) {
        partId = existing.id
        toast.show(t('intake.add_to_existing'), 'info')
      } else {
        const part: Part = {
          id: existing?.id ?? uuidv7(), category_id: category.id, sku, name: finalName,
          mpn: null, manufacturer: null, attributes: attrs, tags: buildTags(finalName, attrs, category),
          count_mode: mode, abc_class: 'C', min_qty: null, unit: mode === 'exact' ? unit : 'adet',
          datasheet_url: null, photo_id: null, notes: null, updated_at: '', deleted_at: null,
        }
        partId = await savePart(part)
      }
      if (mode === 'exact') {
        const n = Number(qty)
        await moveStock({ partId, locationId: locationMatch.id, delta: Number.isFinite(n) ? n : 0, reason: 'initial' })
      } else if (mode === 'level' && level) {
        await setLevel(partId, locationMatch.id, level)
      } else if (mode === 'unmanaged') {
        await moveStock({ partId, locationId: locationMatch.id, delta: 0, reason: 'initial' })
      }
      toast.show(t('intake.saved', { code: sku }), 'success')
      // Seri modda: aynı kategori, temiz form, 2. adıma dön.
      setAttrs({}); setName(''); setQty(''); setLvl(null)
      if (serial) setStep(2)
      else { setCatId(''); setStep(1) }
    } finally {
      setBusy(false)
    }
  }

  // Misafir (viewer) parça ekleyemez.
  if (!canWrite) {
    return (
      <>
        <AppHeader title={t('intake.title')} />
        <Container>
          <div className="card card-pad mx-auto mt-8 max-w-md text-center">
            <div className="text-lg font-semibold text-brand-800">{t('perm.readonly_title')}</div>
            <p className="mt-2 text-sm text-brand-400">{t('perm.no_add')}</p>
          </div>
        </Container>
      </>
    )
  }

  return (
    <>
      <AppHeader title={t('intake.title')} />
      <Container>
        <div className="mx-auto max-w-2xl">
          <Stepper step={step} labels={[t('intake.choose_category'), t('intake.attributes'), t('intake.location')]} />

          {/* Adım 1 — Kategori */}
          {step === 1 && (
            <div className="card card-pad">
              <div className="relative mb-3">
                <IconSearch size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-300" />
                <input className="input pl-10" placeholder={t('intake.choose_category')} value={catQuery} onChange={(e) => setCatQuery(e.target.value)} />
              </div>
              <div className="max-h-[60vh] space-y-4 overflow-y-auto">
                {groups.map((g) => (
                  <div key={g.name}>
                    <div className="section-title mb-1.5 flex items-center gap-1.5"><IconFolder size={13} /> {g.name}</div>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {g.items.map((c) => (
                        <button key={c.id} onClick={() => pickCategory(c.id)}
                          className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5 text-left transition-colors hover:border-accent hover:bg-accent/5">
                          <span className="flex items-center gap-2">
                            <span className="badge bg-brand-50 font-mono text-brand-500">{c.code}</span>
                            <span className="text-sm font-medium text-brand-800">{c.name_tr}</span>
                          </span>
                          <IconChevronRight size={16} className="text-brand-300" />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {groups.length === 0 && <p className="py-8 text-center text-brand-400">{t('search.no_results')}</p>}
              </div>
            </div>
          )}

          {/* Adım 2 — Özellikler */}
          {step === 2 && category && (
            <div className="card card-pad">
              <button onClick={() => setStep(1)} className="mb-4 flex items-center gap-2 text-sm text-brand-500 hover:text-brand-800">
                <span className="badge bg-brand-50 font-mono">{category.code}</span>
                <span className="font-semibold text-brand-800">{category.name_tr}</span>
                <span className="text-brand-300">· değiştir</span>
              </button>

              {category.attribute_schema && category.attribute_schema.length > 0 && (
                <AttributeForm schema={category.attribute_schema} values={attrs} onChange={(k, v) => setAttrs((a) => ({ ...a, [k]: v }))} />
              )}

              <div className="mt-4 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2.5">
                <span className="text-xs text-brand-400">{t('intake.code_preview')}</span>
                <span className="font-mono font-bold text-brand-800">{sku || '—'}</span>
              </div>
              <div className="mt-3">
                <label className="field-label">{t('intake.name_auto')}</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>

              <div className="mt-5 flex justify-between">
                <button onClick={() => setStep(1)} className="btn-ghost"><IconBack size={16} /> {t('common.back')}</button>
                <button onClick={() => setStep(3)} disabled={!attrsComplete || !sku} className="btn-primary">
                  {t('common.next')} <IconChevronRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Adım 3 — Konum & Adet */}
          {step === 3 && category && (
            <div className="card card-pad">
              <div className="mb-4 flex items-center gap-2 text-sm">
                <span className="badge bg-brand-50 font-mono">{category.code}</span>
                <span className="font-semibold text-brand-800">{sku}</span>
              </div>

              <label className="field-label">{t('intake.location')}</label>
              <input list="loc-codes" value={locCode} onChange={(e) => setLocCode(e.target.value)}
                placeholder={t('intake.location_placeholder')} className="input font-mono uppercase" autoCapitalize="characters" />
              <datalist id="loc-codes">
                {storableLocations.map((l) => <option key={l.id} value={l.code}>{l.name ?? l.path}</option>)}
              </datalist>
              {typedCode && !exactLoc && <p className="field-hint text-red-600">{t('scan.not_found', { code: locCode })}</p>}
              {containerMatch && <p className="field-hint text-amber-600">{t('intake.location_is_group', { code: containerMatch.code })}</p>}
              {locationMatch && <p className="field-hint text-green-700">{locationMatch.path}</p>}

              <div className="mt-4">
                {mode === 'exact' && (
                  <>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="field-label">{t('intake.qty')}</label>
                        <input type="number" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className="input" placeholder="0" />
                      </div>
                      <div className="w-32">
                        <label className="field-label">{t('intake.unit')}</label>
                        <select className="select" value={unit} onChange={(e) => setUnit(e.target.value)}>
                          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </div>
                    </div>
                    <p className="field-hint">{t('intake.qty_hint')}</p>
                  </>
                )}
                {mode === 'level' && (
                  <>
                    <label className="field-label">{t('intake.level')}</label>
                    <div className="flex gap-2">
                      {LEVELS.map((lvl) => (
                        <button key={lvl} onClick={() => setLvl(lvl)}
                          className={`btn flex-1 ${level === lvl ? 'bg-brand-700 text-white' : 'bg-brand-50 text-brand-500'}`}>
                          {LEVEL_LABEL[lvl]}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {mode === 'unmanaged' && <p className="text-sm text-brand-400">{t('count_mode.unmanaged_hint')}</p>}
              </div>

              <label className="mt-4 flex items-center gap-2 text-sm text-brand-500">
                <input type="checkbox" checked={serial} onChange={(e) => setSerial(e.target.checked)} /> {t('intake.serial_mode')}
              </label>

              <div className="mt-5 flex justify-between">
                <button onClick={() => setStep(2)} className="btn-ghost"><IconBack size={16} /> {t('common.back')}</button>
                <button onClick={() => void onSave()} disabled={!canSave} className="btn-primary btn-lg">
                  <IconCheck size={18} /> {serial ? t('intake.save_next') : t('intake.save')}
                </button>
              </div>
            </div>
          )}
        </div>
      </Container>
    </>
  )
}
