import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AppHeader, Container } from '../components/Layout'
import { useCategories, useLocations } from '../db/queries'
import { AttributeForm } from '../components/AttributeForm'
import { LocationPicker, resolveLeaf } from '../components/LocationPicker'
import type { Category, Part, PartAttributes, StockLevel } from '../db/types'
import { buildSku, autoName, buildTags } from '../lib/sku'
import { UNITS } from '../lib/units'
import { normalize } from '../lib/normalize'
import { uuidv7 } from '../lib/uuid'
import { db } from '../db/dexie'
import { savePart, moveStock, setLevel } from '../db/actions'
import { levelLabel, unitLabel } from '../lib/format'
import { useT } from '../i18n'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { IconCheck, IconChevronRight, IconBack, IconSearch, IconFolder, IconEdit, IconSparkle, IconBarcode } from '../components/icons'
import { CategoryEditModal } from '../components/settings/CategoryEditor'
import { ScanModal } from '../components/ScanModal'
import { api } from '../sync/api'
import { downscaleImage, blobToBase64 } from '../lib/image'

const LEVELS: StockLevel[] = ['full', 'low', 'empty']

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
  const [mpn, setMpn] = useState('')
  const [manufacturer, setManuf] = useState('')
  const [scanning, setScanning] = useState(false)
  const [locCode, setLocCode] = useState(searchParams.get('location') ?? '')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('adet')
  const [level, setLvl] = useState<StockLevel | null>(null)
  const [serial, setSerial] = useState(true)
  const [busy, setBusy] = useState(false)
  const [editCat, setEditCat] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const aiInputRef = useRef<HTMLInputElement>(null)

  // AI tanıma açık mı? (anahtar yoksa sunucu 200 + disabled döner — hata değil.)
  useEffect(() => {
    api.aiStatus().then((s) => setAiEnabled(s.ai_enabled)).catch(() => setAiEnabled(false))
  }, [])

  // Kategori değişince MPN/üretici sıfırla — önceki parçanın kodu yeni parçaya sızmasın.
  useEffect(() => { setMpn(''); setManuf('') }, [catId])

  /** Fotoğraftan öznitelik önerisi al ve formu ön-doldur (FAZ 2.3). */
  async function onAiPhoto(file: File | undefined): Promise<void> {
    if (!file || !category) return
    if (!aiEnabled) { toast.show(t('ai.disabled_hint'), 'error'); return }
    setAiBusy(true)
    try {
      const { blob } = await downscaleImage(file, 1024, 0.8)
      const res = await api.aiIdentify(await blobToBase64(blob), 'image/jpeg')
      if (!res.ai_enabled) { toast.show(t('ai.disabled_hint'), 'error'); return }
      const s = res.suggestion
      if (!s) { toast.show(t('ai.no_result'), 'error'); return }
      if (typeof s.name === 'string' && s.name.trim()) setName(s.name.trim())
      if (typeof s.mpn === 'string' && s.mpn.trim()) setMpn(s.mpn.trim())
      if (typeof s.manufacturer === 'string' && s.manufacturer.trim()) setManuf(s.manufacturer.trim())
      const schemaKeys = new Set((category.attribute_schema ?? []).map((a) => a.key))
      const sug = s.attributes
      if (sug && typeof sug === 'object') {
        setAttrs((prev) => {
          const next = { ...prev }
          for (const [k, v] of Object.entries(sug as Record<string, unknown>)) {
            if (schemaKeys.has(k) && (typeof v === 'string' || typeof v === 'number')) next[k] = v
          }
          return next
        })
      }
      const conf = typeof s.confidence === 'number' ? `${Math.round(s.confidence * 100)}%` : '?'
      toast.show(t('ai.applied', { conf }), 'success')
    } catch {
      toast.show(t('ai.error'), 'error')
    } finally {
      setAiBusy(false)
    }
  }

  /** Barkod okundu: MPN'i doldur; bu kod zaten bir parçada varsa uyar (mükerrer önleme). */
  async function onBarcode(code: string): Promise<void> {
    setMpn(code)
    const hit = await db.parts.filter((p) => !p.deleted_at && (p.mpn === code || p.sku === code)).first()
    toast.show(hit ? t('intake.barcode_exists', { name: hit.name }) : t('intake.barcode_filled'), hit ? 'info' : 'success')
  }

  const selectable = useMemo(() => categories.filter((c) => c.sku_template), [categories])
  // Üç kademeli ağaç: KÖK (ör. Elektronik) → ALT GRUP (ör. Pasif) → YAPRAK (ör. Direnç).
  // Yaprak doğrudan kökün altındaysa (ara grupsuz) sanal "__direct__" grubunda toplanır.
  const tree = useMemo(() => {
    const q = normalize(catQuery)
    const byId = new Map(categories.map((c) => [c.id, c]))
    const sortKey = (c: Category | null | undefined) => (c ? (c.sort_order ?? 0) : Number.MAX_SAFE_INTEGER)
    type Group = { group: Category | null; items: Category[] }
    type Root = { root: Category | null; subs: Map<string, Group> }
    const roots = new Map<string, Root>()
    for (const c of selectable) {
      if (q && !normalize(c.name_tr).includes(q) && !normalize(c.code).includes(q)) continue
      const parent = c.parent_id ? byId.get(c.parent_id) : undefined
      const grand = parent?.parent_id ? byId.get(parent.parent_id) : undefined
      // grand varsa: kök=grand, ara grup=parent. Yoksa parent kök, ara grup yok.
      const rootCat = grand ?? parent
      const groupCat = grand ? parent : undefined
      const rKey = rootCat?.id ?? '__root__'
      if (!roots.has(rKey)) roots.set(rKey, { root: rootCat ?? null, subs: new Map() })
      const rEntry = roots.get(rKey)!
      const gKey = groupCat?.id ?? '__direct__'
      if (!rEntry.subs.has(gKey)) rEntry.subs.set(gKey, { group: groupCat ?? null, items: [] })
      rEntry.subs.get(gKey)!.items.push(c)
    }
    // Kök → alt grup → yaprak: her seviyeyi sort_order'a göre sırala.
    return [...roots.values()]
      .sort((a, b) => sortKey(a.root) - sortKey(b.root))
      .map((r) => ({
        root: r.root,
        subs: [...r.subs.values()]
          .sort((a, b) => sortKey(a.group) - sortKey(b.group))
          .map((g) => ({ group: g.group, items: [...g.items].sort((a, b) => sortKey(a) - sortKey(b)) })),
      }))
  }, [selectable, categories, catQuery])
  const hasResults = tree.some((r) => r.subs.some((g) => g.items.length > 0))

  const category = categories.find((c) => c.id === catId)
  const sku = category ? buildSku(category.sku_template, attrs) : ''
  const mode = category?.default_count_mode ?? 'exact'

  // Parça yalnızca YAPRAK konuma eklenir (alt konumu olmayan çekmece/göz);
  // öneri/doğrulama LocationPicker'da. Burada yalnızca kaydedilecek eşleşme türetilir.
  const locationMatch = resolveLeaf(locCode, locations)

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
        // Mevcut parçanın sayım yöntemi formdakiyle uyuşmalı — yoksa miktarlı parçaya
        // doluluk (veya tersi) yazılıp stok bozulur.
        if (existing.count_mode !== mode) {
          toast.show(t('intake.mode_conflict', { code: sku, mode: t(`count_mode.${existing.count_mode}`) }), 'error')
          return
        }
        partId = existing.id
        // Barkod/AI ile taranan MPN/üretici mevcut parçada BOŞSA geri-doldur (sessiz kayıp
        // önle). Mevcut değeri EZMEZ (farklı barkod okunmuş olabilir) — yalnız boşluğu doldurur.
        const newMpn = mpn.trim() || null
        const newManuf = manufacturer.trim() || null
        if ((newMpn && !existing.mpn) || (newManuf && !existing.manufacturer)) {
          const merged: Part = {
            ...existing,
            mpn: existing.mpn ?? newMpn,
            manufacturer: existing.manufacturer ?? newManuf,
          }
          merged.tags = buildTags(merged.name, merged.attributes, category, merged.manufacturer, merged.mpn)
          await savePart(merged)
        }
        toast.show(t('intake.add_to_existing'), 'info')
      } else {
        const part: Part = {
          id: existing?.id ?? uuidv7(), category_id: category.id, sku, name: finalName,
          mpn: mpn.trim() || null, manufacturer: manufacturer.trim() || null,
          attributes: attrs, tags: buildTags(finalName, attrs, category, manufacturer, mpn),
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
        // Varlık işareti: +1. (Taşıma −1/+1 ile çalışır; qty<0 satır "orada değil" sayılır.)
        await moveStock({ partId, locationId: locationMatch.id, delta: 1, reason: 'initial' })
      }
      toast.show(t('intake.saved', { code: sku }), 'success')
      // Seri modda: aynı kategori, temiz form, 2. adıma dön.
      setAttrs({}); setName(''); setMpn(''); setManuf(''); setQty(''); setLvl(null)
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
              <div className="max-h-[60vh] space-y-5 overflow-y-auto">
                {tree.map((r) => (
                  <div key={r.root?.id ?? '__root__'}>
                    {/* Ana başlık (kök) — ör. Elektronik. Alt gruplardan belirgin ayrılsın. */}
                    <div className="mb-2.5 flex items-center gap-2 border-b-2 border-accent pb-1.5 text-base font-extrabold uppercase tracking-wide text-brand-900">
                      <IconFolder size={17} className="text-accent" /> {r.root?.name_tr ?? t('intake.group_other')}
                    </div>
                    <div className="space-y-3 pl-1">
                      {r.subs.map((g) => (
                        <div key={g.group?.id ?? '__direct__'}>
                          {/* Ara grup başlığı — ör. Pasif (yalnızca varsa) */}
                          {g.group && (
                            <div className="section-title mb-1.5">{g.group.name_tr}</div>
                          )}
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
                    </div>
                  </div>
                ))}
                {!hasResults && <p className="py-8 text-center text-brand-400">{t('search.no_results')}</p>}
              </div>
            </div>
          )}

          {/* Adım 2 — Özellikler */}
          {step === 2 && category && (
            <div className="card card-pad">
              <div className="mb-4 flex items-center justify-between gap-2">
                <button onClick={() => setStep(1)} className="flex min-w-0 items-center gap-2 text-sm text-brand-500 hover:text-brand-800">
                  <span className="badge bg-brand-50 font-mono">{category.code}</span>
                  <span className="truncate font-semibold text-brand-800">{category.name_tr}</span>
                  <span className="shrink-0 text-brand-300">· değiştir</span>
                </button>
                {/* Kategorinin özniteliklerini/SKU şablonunu buradan düzenle — Ayarlar'daki editörün aynısı. */}
                {canWrite && (
                  <button onClick={() => setEditCat(true)} className="btn-ghost h-8 shrink-0 px-2 text-xs text-brand-500">
                    <IconEdit size={14} /> {t('intake.edit_category')}
                  </button>
                )}
              </div>
              {editCat && <CategoryEditModal initial={category} onClose={() => setEditCat(false)} />}
              {scanning && (
                <ScanModal
                  title={t('intake.scan_barcode')}
                  onClose={() => setScanning(false)}
                  onResult={(code) => { setScanning(false); void onBarcode(code) }}
                />
              )}

              {/* Fotoğraftan tanı (AI, FAZ 2.3) — anahtar yoksa nazik uyarı. */}
              {canWrite && (
                <>
                  <input ref={aiInputRef} type="file" accept="image/*" capture="environment" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void onAiPhoto(f) }} />
                  <button type="button" disabled={aiBusy}
                    onClick={() => (aiEnabled ? aiInputRef.current?.click() : toast.show(t('ai.disabled_hint'), 'error'))}
                    className={`mb-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm ${
                      aiEnabled ? 'border-accent text-brand-700 hover:bg-accent/5' : 'border-line text-brand-300'
                    }`}>
                    <IconSparkle size={15} /> {aiBusy ? t('ai.identifying') : t('ai.button')}
                  </button>
                </>
              )}

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

              {/* Üretici kodu (MPN) — barkod okutup doldurulabilir + üretici */}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <label className="field-label">{t('part.mpn')} <span className="text-brand-300">({t('common.optional')})</span></label>
                  <div className="flex gap-1.5">
                    <input className="input font-mono" value={mpn} onChange={(e) => setMpn(e.target.value)} placeholder="MPN" />
                    <button type="button" onClick={() => setScanning(true)}
                      className="btn-navy shrink-0 px-3" title={t('intake.scan_barcode')} aria-label={t('intake.scan_barcode')}>
                      <IconBarcode size={18} />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="field-label">{t('part.manufacturer')} <span className="text-brand-300">({t('common.optional')})</span></label>
                  <input className="input" value={manufacturer} onChange={(e) => setManuf(e.target.value)} placeholder={t('part.manufacturer')} />
                </div>
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

              <label className="field-label" htmlFor="intake-loc">{t('intake.location')}</label>
              {/* Gruplu combobox: dolap başlıkları altında çekmece önerileri; akıllı doğrulama */}
              <LocationPicker id="intake-loc" value={locCode} onChange={setLocCode} locations={locations} />

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
                          {[...UNITS].sort((a, b) => unitLabel(t, a).localeCompare(unitLabel(t, b), 'tr')).map((u) => <option key={u} value={u}>{unitLabel(t, u)}</option>)}
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
                          {levelLabel(t, lvl)}
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
