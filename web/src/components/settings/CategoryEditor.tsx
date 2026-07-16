import { useState } from 'react'
import { useCategories } from '../../db/queries'
import type { AttributeDef, Category, CountMode } from '../../db/types'
import { saveCategory } from '../../db/actions'
import { uuidv7 } from '../../lib/uuid'
import { foldToAscii } from '../../lib/normalize'
import { deriveSkuTemplate } from '../../lib/sku'
import { useT } from '../../i18n'
import { useToast } from '../Toast'
import { IconPlus, IconX } from '../icons'

export const MODES: CountMode[] = ['exact', 'level', 'unmanaged']

export function emptyCategory(parentId: string | null, sort: number): Category {
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
export function AttributeEditor({ schema, onChange }: { schema: AttributeDef[]; onChange: (s: AttributeDef[]) => void }) {
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

/**
 * Kategori düzenleme/ekleme formu — TEK KAYNAK. Hem Ayarlar→Kategoriler hem Parça Ekle
 * pop-up'ı bu formu kullanır; böylece nereden düzenlersen düzenle sonuç aynıdır.
 * `initial` bir kez state'e alınır; farklı kategori için çağıran taraf `key` ile remount etmeli.
 */
export function CategoryEditForm({ initial, onDone }: { initial: Category; onDone: () => void }) {
  const { t } = useT()
  const toast = useToast()
  const categories = useCategories()
  const [draft, setDraft] = useState<Category>(initial)
  const isEdit = categories.some((c) => c.id === initial.id)

  /** Taslağı günceller ve SKU şablonunu "koda girer" işaretlerinden yeniden türetir. */
  function patchDraft(patch: Partial<Category>) {
    setDraft((d) => {
      const next = { ...d, ...patch }
      next.sku_template = deriveSkuTemplate(next.code, next.attribute_schema ?? [], d.sku_template)
      return next
    })
  }

  /** id + tüm alt kategorileri (üst kategori seçiminde döngüyü önlemek için). */
  function selfAndDescendants(id: string): Set<string> {
    const out = new Set<string>([id])
    let grew = true
    while (grew) {
      grew = false
      for (const c of categories) {
        if (c.parent_id && out.has(c.parent_id) && !out.has(c.id)) { out.add(c.id); grew = true }
      }
    }
    return out
  }

  async function save() {
    const code = foldToAscii(draft.code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3)
    if (!draft.name_tr.trim() || !code) {
      toast.show(t('settings.categories.need_name_code'), 'error'); return
    }
    if (categories.some((c) => c.id !== draft.id && c.code === code)) {
      toast.show(t('settings.categories.code_taken', { code }), 'error'); return
    }
    const keys = (draft.attribute_schema ?? []).map((a) => a.key).filter(Boolean)
    if (new Set(keys).size !== keys.length) {
      toast.show(t('settings.categories.dup_attr'), 'error'); return
    }
    if (draft.parent_id && selfAndDescendants(draft.id).has(draft.parent_id)) {
      toast.show(t('settings.categories.cycle'), 'error'); return
    }
    await saveCategory({ ...draft, code })
    toast.show(t('common.save'), 'success')
    onDone()
  }

  return (
    <>
      <h3 className="mb-3 text-sm font-semibold text-brand-700">
        {isEdit ? t('settings.categories.edit_title') : t('settings.categories.add_title')}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="field-label">{t('settings.categories.name')}</label>
          <input className="input" value={draft.name_tr} onChange={(e) => setDraft({ ...draft, name_tr: e.target.value })} />
        </div>
        <div>
          <label className="field-label">{t('settings.categories.code')}</label>
          {/* Kategori kodu SKU önekidir — kısa tut: en fazla 3 karakter. */}
          <input className="input font-mono uppercase" maxLength={3} value={draft.code}
            onChange={(e) => patchDraft({ code: foldToAscii(e.target.value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) })} />
          <p className="field-hint">{t('settings.categories.code_hint')}</p>
        </div>
        <div>
          <label className="field-label">{t('settings.categories.parent')}</label>
          <select className="select" value={draft.parent_id ?? ''} onChange={(e) => setDraft({ ...draft, parent_id: e.target.value || null })}>
            <option value="">{t('settings.categories.no_parent')}</option>
            {(() => { const banned = selfAndDescendants(draft.id); return categories.filter((c) => !banned.has(c.id)) })()
              .sort((a, b) => a.name_tr.localeCompare(b.name_tr, 'tr'))
              .map((c) => <option key={c.id} value={c.id}>{c.name_tr}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">{t('settings.categories.count_mode')}</label>
          <select className="select" value={draft.default_count_mode} onChange={(e) => setDraft({ ...draft, default_count_mode: e.target.value as CountMode })}>
            {MODES.map((m) => <option key={m} value={m}>{t(`count_mode.${m}`)}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="field-label">{t('settings.categories.title')} — {t('part.attributes')}</label>
          <AttributeEditor schema={draft.attribute_schema ?? []} onChange={(s) => patchDraft({ attribute_schema: s })} />
        </div>
        <div className="sm:col-span-2">
          <label className="field-label">{t('settings.categories.template')}</label>
          <div className="flex items-center gap-2 rounded-lg border border-line bg-brand-50 px-3 py-2.5">
            <span className="font-mono text-sm font-bold text-brand-800">{draft.sku_template || draft.code || '—'}</span>
            <span className="ml-auto text-[11px] text-brand-300">{t('settings.categories.template_auto')}</span>
          </div>
          <p className="field-hint">{t('settings.categories.template_hint')}</p>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onDone} className="btn-ghost">{t('common.cancel')}</button>
        <button onClick={() => void save()} className="btn-primary">{t('common.save')}</button>
      </div>
    </>
  )
}

/**
 * Modal sarmalayıcı — Parça Ekle ekranından "Kategoriyi düzenle" için. Ayarlar'daki
 * editörün AYNISINI (CategoryEditForm) gösterir; kaydedince kategori güncellenir ve
 * UI Dexie'den okuduğu için form canlı yenilenir.
 */
export function CategoryEditModal({ initial, onClose }: { initial: Category; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose} role="dialog" aria-modal="true">
      <div className="card card-pad my-8 w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex justify-end">
          <button onClick={onClose} className="btn-icon h-8 w-8 text-brand-400 hover:bg-canvas" aria-label="kapat">
            <IconX size={18} />
          </button>
        </div>
        <CategoryEditForm initial={initial} onDone={onClose} />
      </div>
    </div>
  )
}
