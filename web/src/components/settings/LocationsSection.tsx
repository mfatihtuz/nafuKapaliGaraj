import { useMemo, useState } from 'react'
import { useLocations } from '../../db/queries'
import { db } from '../../db/dexie'
import type { Location, LocationType } from '../../db/types'
import { saveLocation, softDeleteLocation } from '../../db/actions'
import { uuidv7 } from '../../lib/uuid'
import { foldToAscii } from '../../lib/normalize'
import { useT } from '../../i18n'
import { useToast } from '../Toast'
import { IconPlus, IconTrash, IconEdit, IconChevronRight, IconLayers } from '../icons'

/** Kullanıcının seçebileceği fiziksel konum tipleri (sistem tipleri gizli). */
const EDITABLE_TYPES: LocationType[] = ['site', 'cabinet', 'shelf', 'drawer', 'bin']
const SYSTEM_TYPES: LocationType[] = ['bench', 'intake', 'quarantine', 'loan', 'project']

function sanitizeCode(raw: string): string {
  return foldToAscii(raw).toUpperCase().replace(/[^A-Z0-9-]/g, '')
}
const pad2 = (n: number) => String(n).padStart(2, '0')

function emptyLocation(parent: Location | null, sort: number): Location {
  return {
    id: uuidv7(),
    parent_id: parent?.id ?? null,
    code: '',
    name: null,
    type: parent ? (parent.type === 'cabinet' ? 'drawer' : 'cabinet') : 'cabinet',
    path: '',
    photo_id: null,
    capacity_note: null,
    sort_order: sort,
    updated_at: '',
    deleted_at: null,
  }
}

export function LocationsSection({ canWrite }: { canWrite: boolean }) {
  const { t } = useT()
  const toast = useToast()
  const locations = useLocations()
  const [draft, setDraft] = useState<Location | null>(null)
  const [gen, setGen] = useState(false)
  const [open, setOpen] = useState<Set<string>>(() => new Set())

  const byId = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])
  const roots = useMemo(() => locations.filter((l) => !l.parent_id), [locations])
  const childrenOf = (id: string) => locations.filter((l) => l.parent_id === id)
  const maxSort = locations.reduce((m, l) => Math.max(m, l.sort_order), 0)
  const toggle = (id: string) =>
    setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  function selfAndDescendants(id: string): Set<string> {
    const out = new Set<string>([id])
    let grew = true
    while (grew) {
      grew = false
      for (const l of locations) {
        if (l.parent_id && out.has(l.parent_id) && !out.has(l.id)) { out.add(l.id); grew = true }
      }
    }
    return out
  }

  function pathFor(parentId: string | null, code: string): string {
    const parent = parentId ? byId.get(parentId) : undefined
    return parent ? `${parent.path}/${code}` : code
  }

  async function save() {
    if (!draft) return
    const code = sanitizeCode(draft.code)
    if (!code) { toast.show(t('settings.locations.need_code'), 'error'); return }
    if (locations.some((l) => l.id !== draft.id && l.code.toUpperCase() === code)) {
      toast.show(t('settings.locations.code_taken', { code }), 'error'); return
    }
    if (draft.parent_id && selfAndDescendants(draft.id).has(draft.parent_id)) {
      toast.show(t('settings.locations.cycle'), 'error'); return
    }
    await saveLocation({ ...draft, code, path: pathFor(draft.parent_id, code), name: draft.name?.trim() || null })
    setDraft(null)
    toast.show(t('common.save'), 'success')
  }

  async function remove(l: Location) {
    if (childrenOf(l.id).length > 0) {
      toast.show(t('settings.locations.has_children'), 'error'); return
    }
    // Konumda (veya alt konumlarında) stok varsa silme — yetim stok oluşur.
    const subtree = selfAndDescendants(l.id)
    const stockRows = await db.stock.toArray()
    const hasStock = stockRows.some((s) => subtree.has(s.location_id) && (Number(s.qty) > 0 || s.level != null))
    if (hasStock) { toast.show(t('settings.locations.has_stock'), 'error'); return }
    if (!confirm(t('settings.locations.delete_confirm', { code: l.code }))) return
    await softDeleteLocation(l.id)
  }

  const typeLabel = (ty: LocationType) => t(`loc_type.${ty}`)

  function Row({ l, depth }: { l: Location; depth: number }) {
    const kids = childrenOf(l.id)
    const isOpen = open.has(l.id)
    const isSystem = SYSTEM_TYPES.includes(l.type)
    return (
      <>
        <div className="row" style={{ paddingLeft: depth * 18 }}>
          {kids.length > 0 ? (
            <button onClick={() => toggle(l.id)} className="btn-icon h-7 w-7 text-brand-400 hover:bg-canvas" aria-label={t('common.toggle')}>
              <IconChevronRight size={15} className={isOpen ? 'rotate-90 transition-transform' : 'transition-transform'} />
            </button>
          ) : <span className="w-7" />}
          <span className="loc-code text-base">{l.code}</span>
          <button onClick={() => kids.length > 0 && toggle(l.id)} className="min-w-0 flex-1 truncate text-left text-sm text-brand-600">
            {l.name}
            {kids.length > 0 && <span className="ml-2 text-xs font-normal text-brand-300">{kids.length}</span>}
          </button>
          <span className="hidden text-[11px] text-brand-400 sm:inline">{typeLabel(l.type)}</span>
          {canWrite && !isSystem && (
            <>
              <button onClick={() => setDraft(emptyLocation(l, maxSort + 10))} title={t('settings.locations.add_child')} aria-label={t('settings.locations.add_child')} className="btn-icon h-8 w-8 text-brand-300 hover:bg-canvas">
                <IconPlus size={16} />
              </button>
              <button onClick={() => setDraft({ ...l })} title={t('common.edit')} aria-label={t('common.edit')} className="btn-icon h-8 w-8 text-brand-400 hover:bg-canvas">
                <IconEdit size={15} />
              </button>
              <button onClick={() => void remove(l)} title={t('common.delete')} aria-label={t('common.delete')} className="btn-icon h-8 w-8 text-brand-300 hover:bg-red-50 hover:text-red-600">
                <IconTrash size={15} />
              </button>
            </>
          )}
          {isSystem && <span className="chip bg-brand-50 text-[10px] text-brand-400">{t('location.system')}</span>}
        </div>
        {isOpen && kids.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })).map((ch) => <Row key={ch.id} l={ch} depth={depth + 1} />)}
      </>
    )
  }

  return (
    <div className="card card-pad">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-brand-800">{t('settings.locations.title')}</h2>
          <p className="text-sm text-brand-400">{t('settings.locations.subtitle')}</p>
        </div>
        {canWrite && !draft && !gen && (
          <div className="flex gap-2">
            <button onClick={() => setGen(true)} className="btn-outline"><IconLayers size={16} /> {t('settings.locations.bulk')}</button>
            <button onClick={() => setDraft(emptyLocation(null, maxSort + 10))} className="btn-primary"><IconPlus size={18} /> {t('settings.locations.add')}</button>
          </div>
        )}
      </div>

      {draft && (
        <LocationEditor
          draft={draft} setDraft={setDraft} locations={locations}
          bannedParents={selfAndDescendants(draft.id)}
          onSave={() => void save()} onCancel={() => setDraft(null)}
        />
      )}

      {gen && (
        <BulkGenerator
          locations={locations} baseSort={maxSort + 10}
          onDone={() => setGen(false)}
        />
      )}

      <div>
        {roots.sort((a, b) => a.sort_order - b.sort_order).map((l) => <Row key={l.id} l={l} depth={0} />)}
        {roots.length === 0 && <p className="py-6 text-center text-brand-400">{t('settings.locations.empty')}</p>}
      </div>
    </div>
  )
}

/** Tekil konum düzenleyici. */
function LocationEditor({
  draft, setDraft, locations, bannedParents, onSave, onCancel,
}: {
  draft: Location; setDraft: (l: Location) => void; locations: Location[]
  bannedParents: Set<string>; onSave: () => void; onCancel: () => void
}) {
  const { t } = useT()
  const editing = locations.some((l) => l.id === draft.id)
  return (
    <div className="mb-5 rounded-xl border border-line bg-canvas p-4">
      <h3 className="mb-3 text-sm font-semibold text-brand-700">
        {editing ? t('settings.locations.edit_title') : t('settings.locations.add_title')}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="field-label">{t('settings.locations.code')}</label>
          <input className="input font-mono uppercase" value={draft.code}
            onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="S4-01" />
        </div>
        <div>
          <label className="field-label">{t('settings.locations.name')}</label>
          <input className="input" value={draft.name ?? ''}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t('common.optional')} />
        </div>
        <div>
          <label className="field-label">{t('settings.locations.type')}</label>
          <select className="select" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as LocationType })}>
            {EDITABLE_TYPES.map((ty) => <option key={ty} value={ty}>{t(`loc_type.${ty}`)}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">{t('settings.locations.parent')}</label>
          <select className="select" value={draft.parent_id ?? ''} onChange={(e) => setDraft({ ...draft, parent_id: e.target.value || null })}>
            <option value="">{t('settings.locations.no_parent')}</option>
            {locations.filter((l) => !bannedParents.has(l.id)).map((l) => (
              <option key={l.id} value={l.id}>{'  '.repeat(0)}{l.code}{l.name ? ` — ${l.name}` : ''}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancel} className="btn-ghost">{t('common.cancel')}</button>
        <button onClick={onSave} className="btn-primary">{t('common.save')}</button>
      </div>
    </div>
  )
}

/** Toplu çekmece üretici — bir dolap + altına düz veya modüllü çekmeceler. */
function BulkGenerator({
  locations, baseSort, onDone,
}: { locations: Location[]; baseSort: number; onDone: () => void }) {
  const { t } = useT()
  const toast = useToast()
  const byId = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])

  const [parentId, setParentId] = useState('')
  const [createCabinet, setCreateCabinet] = useState(true)
  const [prefix, setPrefix] = useState('')
  const [cabName, setCabName] = useState('')
  const [structure, setStructure] = useState<'flat' | 'modules'>('flat')
  const [modules, setModules] = useState('3')
  const [drawers, setDrawers] = useState('6')
  const [busy, setBusy] = useState(false)

  const pfx = sanitizeCode(prefix)
  const nMod = Math.max(1, Math.min(50, Number(modules) || 0))
  const nDraw = Math.max(1, Math.min(100, Number(drawers) || 0))
  const drawerTotal = structure === 'flat' ? nDraw : nMod * nDraw
  const total = drawerTotal + (createCabinet ? 1 : 0) + (structure === 'modules' ? nMod : 0)

  // Önizleme örnekleri
  const samples = useMemo(() => {
    if (!pfx) return []
    if (structure === 'flat') return [`${pfx}-01`, `${pfx}-02`, `…`, `${pfx}-${pad2(nDraw)}`]
    return [`${pfx}-01-1`, `${pfx}-01-2`, `…`, `${pfx}-${pad2(nMod)}-${nDraw}`]
  }, [pfx, structure, nMod, nDraw])

  async function generate() {
    if (!pfx) { toast.show(t('settings.locations.need_code'), 'error'); return }
    const existing = new Set(locations.map((l) => l.code.toUpperCase()))
    const parent = parentId ? byId.get(parentId) : undefined
    setBusy(true)
    try {
      let sort = baseSort
      const mk = async (code: string, name: string | null, type: LocationType, pParentId: string | null, pPath: string) => {
        if (existing.has(code.toUpperCase())) return null
        const id = uuidv7()
        await saveLocation({
          id, parent_id: pParentId, code, name, type, path: pPath,
          photo_id: null, capacity_note: null, sort_order: sort++, updated_at: '', deleted_at: null,
        })
        existing.add(code.toUpperCase())
        return id
      }

      // 1) Dolap
      let cabId = parent?.id ?? null
      let cabPath = parent?.path ?? ''
      if (createCabinet) {
        const path = parent ? `${parent.path}/${pfx}` : pfx
        const id = await mk(pfx, cabName.trim() || null, 'cabinet', parent?.id ?? null, path)
        if (id) { cabId = id; cabPath = path } else { cabId = null; cabPath = pfx }
      }
      if (cabPath === '') cabPath = pfx // güvenlik

      // 2) Çekmeceler
      let created = 0
      if (structure === 'flat') {
        for (let i = 1; i <= nDraw; i++) {
          const code = `${pfx}-${pad2(i)}`
          const id = await mk(code, null, 'drawer', cabId, `${cabPath}/${code}`)
          if (id) created++
        }
      } else {
        for (let m = 1; m <= nMod; m++) {
          const mCode = `${pfx}-${pad2(m)}`
          const mId = await mk(mCode, `${t('loc_type.shelf')} ${m}`, 'shelf', cabId, `${cabPath}/${mCode}`)
          const mPath = `${cabPath}/${mCode}`
          for (let k = 1; k <= nDraw; k++) {
            const code = `${mCode}-${k}`
            const id = await mk(code, null, 'drawer', mId ?? cabId, `${mPath}/${code}`)
            if (id) created++
          }
        }
      }
      toast.show(t('settings.locations.generated', { n: created }), 'success')
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-5 rounded-xl border border-accent/40 bg-accent/5 p-4">
      <h3 className="mb-1 text-sm font-semibold text-brand-700">{t('settings.locations.bulk_title')}</h3>
      <p className="mb-3 text-xs text-brand-400">{t('settings.locations.bulk_hint')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="field-label">{t('settings.locations.parent')}</label>
          <select className="select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">{t('settings.locations.no_parent')}</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.code}{l.name ? ` — ${l.name}` : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">{t('settings.locations.prefix')}</label>
          <input className="input font-mono uppercase" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="S4" />
        </div>
        <label className="flex items-center gap-2 text-sm text-brand-600 sm:col-span-2">
          <input type="checkbox" checked={createCabinet} onChange={(e) => setCreateCabinet(e.target.checked)} />
          {t('settings.locations.create_cabinet')}
        </label>
        {createCabinet && (
          <div className="sm:col-span-2">
            <label className="field-label">{t('settings.locations.cabinet_name')}</label>
            <input className="input" value={cabName} onChange={(e) => setCabName(e.target.value)} placeholder={t('common.optional')} />
          </div>
        )}
        <div>
          <label className="field-label">{t('settings.locations.structure')}</label>
          <select className="select" value={structure} onChange={(e) => setStructure(e.target.value as 'flat' | 'modules')}>
            <option value="flat">{t('settings.locations.flat')}</option>
            <option value="modules">{t('settings.locations.modules')}</option>
          </select>
        </div>
        {structure === 'modules' && (
          <div>
            <label className="field-label">{t('settings.locations.module_count')}</label>
            <input className="input" type="number" inputMode="numeric" value={modules} onChange={(e) => setModules(e.target.value)} />
          </div>
        )}
        <div>
          <label className="field-label">{structure === 'flat' ? t('settings.locations.drawer_count') : t('settings.locations.per_module')}</label>
          <input className="input" type="number" inputMode="numeric" value={drawers} onChange={(e) => setDrawers(e.target.value)} />
        </div>
      </div>

      {pfx && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-lg bg-white p-2 text-xs">
          <span className="font-semibold text-brand-600">{t('settings.locations.preview')}:</span>
          {samples.map((s, i) => <span key={i} className="loc-code">{s}</span>)}
          <span className="ml-auto font-semibold text-brand-700">{t('settings.locations.total', { n: total })}</span>
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onDone} className="btn-ghost">{t('common.cancel')}</button>
        <button onClick={() => void generate()} disabled={busy || !pfx} className="btn-primary">
          <IconLayers size={16} /> {t('settings.locations.generate')}
        </button>
      </div>
    </div>
  )
}
