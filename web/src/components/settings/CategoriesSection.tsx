import { useMemo, useState } from 'react'
import { useCategories } from '../../db/queries'
import type { AttributeDef, Category, CountMode } from '../../db/types'
import { saveCategory, softDeleteCategory } from '../../db/actions'
import { uuidv7 } from '../../lib/uuid'
import { foldToAscii } from '../../lib/normalize'
import { useT } from '../../i18n'
import { useToast } from '../Toast'
import { IconPlus, IconTrash, IconEdit, IconChevronRight } from '../icons'

const MODES: CountMode[] = ['exact', 'level', 'unmanaged']

function emptyCategory(parentId: string | null, sort: number): Category {
  return {
    id: uuidv7(), parent_id: parentId, name_tr: '', name_en: null, code: '',
    attribute_schema: [], sku_template: '', default_count_mode: 'exact',
    sort_order: sort, updated_at: '', deleted_at: null,
  }
}

/**
 * Enum seçenek girişi — HAM metni yerel state'te tutar; `options` yalnızca kayıt için
 * türetilir. Böylece yazarken sondaki virgül/boşluk yenmez ("Arduino UNO, ESP32" çalışır).
 */
function EnumOptionsInput({ value, onChange }: { value: string[]; onChange: (opts: string[]) => void }) {
  const [raw, setRaw] = useState(value.join(', '))
  return (
    <input
      className="input col-span-2 h-9 text-sm"
      placeholder="Seçenekler: Arduino UNO, ESP32, STM32"
      value={raw}
      onChange={(e) => {
        setRaw(e.target.value)
        onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))
      }}
    />
  )
}

/** Kompakt özellik (attribute) editörü. */
function AttributeEditor({ schema, onChange }: { schema: AttributeDef[]; onChange: (s: AttributeDef[]) => void }) {
  const { t } = useT()
  const update = (i: number, patch: Partial<AttributeDef>) => {
    const next = schema.map((a, idx) => (idx === i ? { ...a, ...patch } : a))
    onChange(next)
  }
  return (
    <div className="space-y-2">
      {schema.map((a, i) => (
        <div key={i} className="rounded-lg border border-line bg-canvas p-2.5">
          <div className="grid grid-cols-2 gap-2">
            <input className="input h-9 text-sm" placeholder="anahtar (deger)" value={a.key}
              onChange={(e) => update(i, { key: foldToAscii(e.target.value).toLowerCase().replace(/[^a-z0-9_]/g, '') })} />
            <input className="input h-9 text-sm" placeholder="Etiket (Değer)" value={a.label_tr}
              onChange={(e) => update(i, { label_tr: e.target.value })} />
            <select className="select h-9 text-sm" value={a.type} onChange={(e) => update(i, { type: e.target.value as AttributeDef['type'] })}>
              <option value="text">Metin</option>
              <option value="number">Sayı</option>
              <option value="enum">Seçenek listesi</option>
            </select>
            <input className="input h-9 text-sm" placeholder="birim (Ω)" value={a.unit ?? ''} onChange={(e) => update(i, { unit: e.target.value })} />
            {a.type === 'enum' && (
              <EnumOptionsInput value={a.options ?? []} onChange={(opts) => update(i, { options: opts })} />
            )}
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-brand-500">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!a.required} onChange={(e) => update(i, { required: e.target.checked })} /> zorunlu</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!a.in_sku} onChange={(e) => update(i, { in_sku: e.target.checked })} /> koda girer</label>
            <button onClick={() => onChange(schema.filter((_, idx) => idx !== i))} className="ml-auto text-red-500">{t('common.delete')}</button>
          </div>
        </div>
      ))}
      <button onClick={() => onChange([...schema, { key: '', label_tr: '', type: 'text', order: schema.length + 1 }])}
        className="btn-ghost h-9 w-full text-sm">
        <IconPlus size={15} /> özellik ekle
      </button>
    </div>
  )
}

export function CategoriesSection({ canWrite }: { canWrite: boolean }) {
  const { t } = useT()
  const toast = useToast()
  const categories = useCategories()
  const [draft, setDraft] = useState<Category | null>(null)

  const roots = useMemo(() => categories.filter((c) => !c.parent_id), [categories])
  const childrenOf = (id: string) => categories.filter((c) => c.parent_id === id)
  const maxSort = categories.reduce((m, c) => Math.max(m, c.sort_order), 0)
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const toggle = (id: string) =>
    setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function save() {
    if (!draft) return
    if (!draft.name_tr.trim() || !draft.code.trim()) {
      toast.show('Ad ve kod öneki gerekli', 'error')
      return
    }
    await saveCategory({ ...draft, code: foldToAscii(draft.code).toUpperCase().replace(/[^A-Z0-9]/g, '') })
    setDraft(null)
    toast.show(t('common.save'), 'success')
  }
  async function remove(id: string) {
    if (!confirm(t('settings.categories.delete_confirm'))) return
    await softDeleteCategory(id)
  }

  function Row({ c, depth }: { c: Category; depth: number }) {
    const kids = childrenOf(c.id)
    const isOpen = open.has(c.id)
    return (
      <>
        <div className="row" style={{ paddingLeft: depth * 18 }}>
          {kids.length > 0 ? (
            <button onClick={() => toggle(c.id)} className="btn-icon h-7 w-7 text-brand-400 hover:bg-canvas" aria-label="aç/kapa">
              <IconChevronRight size={15} className={isOpen ? 'rotate-90 transition-transform' : 'transition-transform'} />
            </button>
          ) : (
            <span className="w-7" />
          )}
          <span className="badge bg-brand-50 font-mono text-brand-500">{c.code}</span>
          <button onClick={() => kids.length > 0 && toggle(c.id)} className="min-w-0 flex-1 truncate text-left font-medium text-brand-800">
            {c.name_tr}
            {kids.length > 0 && <span className="ml-2 text-xs font-normal text-brand-300">{kids.length}</span>}
          </button>
          <span className="hidden text-xs text-brand-400 sm:inline">{t(`count_mode.${c.default_count_mode}`)}</span>
          {canWrite && (
            <>
              <button onClick={() => setDraft(emptyCategory(c.id, maxSort + 10))} className="btn-icon h-8 w-8 text-brand-300 hover:bg-canvas" title={t('settings.categories.add_sub')}>
                <IconPlus size={16} />
              </button>
              <button onClick={() => setDraft({ ...c, attribute_schema: c.attribute_schema ?? [] })} className="btn-icon h-8 w-8 text-brand-400 hover:bg-canvas">
                <IconEdit size={15} />
              </button>
              <button onClick={() => void remove(c.id)} className="btn-icon h-8 w-8 text-brand-300 hover:bg-red-50 hover:text-red-600">
                <IconTrash size={15} />
              </button>
            </>
          )}
        </div>
        {isOpen && kids.map((ch) => <Row key={ch.id} c={ch} depth={depth + 1} />)}
      </>
    )
  }

  return (
    <div className="card card-pad">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-brand-800">{t('settings.categories.title')}</h2>
          <p className="text-sm text-brand-400">{t('settings.categories.subtitle')}</p>
        </div>
        {canWrite && !draft && (
          <button onClick={() => setDraft(emptyCategory(null, maxSort + 10))} className="btn-primary">
            <IconPlus size={18} /> {t('settings.categories.add')}
          </button>
        )}
      </div>

      {draft && (
        <div className="mb-5 rounded-xl border border-line bg-canvas p-4">
          <h3 className="mb-3 text-sm font-semibold text-brand-700">
            {categories.some((c) => c.id === draft.id) ? t('settings.categories.edit_title') : t('settings.categories.add_title')}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label">{t('settings.categories.name')}</label>
              <input className="input" value={draft.name_tr} onChange={(e) => setDraft({ ...draft, name_tr: e.target.value })} />
            </div>
            <div>
              <label className="field-label">{t('settings.categories.code')}</label>
              <input className="input font-mono uppercase" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
              <p className="field-hint">{t('settings.categories.code_hint')}</p>
            </div>
            <div>
              <label className="field-label">{t('settings.categories.parent')}</label>
              <select className="select" value={draft.parent_id ?? ''} onChange={(e) => setDraft({ ...draft, parent_id: e.target.value || null })}>
                <option value="">{t('settings.categories.no_parent')}</option>
                {categories.filter((c) => c.id !== draft.id).map((c) => <option key={c.id} value={c.id}>{c.name_tr}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">{t('settings.categories.count_mode')}</label>
              <select className="select" value={draft.default_count_mode} onChange={(e) => setDraft({ ...draft, default_count_mode: e.target.value as CountMode })}>
                {MODES.map((m) => <option key={m} value={m}>{t(`count_mode.${m}`)}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="field-label">{t('settings.categories.template')}</label>
              <input className="input font-mono text-sm" value={draft.sku_template ?? ''} onChange={(e) => setDraft({ ...draft, sku_template: e.target.value })} placeholder="R-{paket}-{deger}" />
              <p className="field-hint">{t('settings.categories.template_hint')}</p>
            </div>
            <div className="sm:col-span-2">
              <label className="field-label">{t('settings.categories.title')} — {t('part.attributes')}</label>
              <AttributeEditor schema={draft.attribute_schema ?? []} onChange={(s) => setDraft({ ...draft, attribute_schema: s })} />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setDraft(null)} className="btn-ghost">{t('common.cancel')}</button>
            <button onClick={() => void save()} className="btn-primary">{t('common.save')}</button>
          </div>
        </div>
      )}

      <div>
        {roots.map((c) => <Row key={c.id} c={c} depth={0} />)}
        {roots.length === 0 && <p className="py-6 text-center text-brand-400">{t('settings.categories.empty')}</p>}
      </div>
    </div>
  )
}
