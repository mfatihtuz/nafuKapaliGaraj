import { useMemo, useState } from 'react'
import { useCategories } from '../../db/queries'
import type { Category } from '../../db/types'
import { softDeleteCategory } from '../../db/actions'
import { useT } from '../../i18n'
import { useToast } from '../Toast'
import { IconPlus, IconTrash, IconEdit, IconChevronRight } from '../icons'
import { CategoryEditForm, emptyCategory } from './CategoryEditor'

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

  async function remove(id: string) {
    // Alt kategorisi olan kategori silinemez — çocuklar yetim kalır ve ağaçta görünmez olur.
    if (categories.some((c) => c.parent_id === id)) {
      toast.show(t('settings.categories.has_children'), 'error')
      return
    }
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
              <button onClick={() => setDraft({ ...c, attribute_schema: c.attribute_schema ?? [] })} title={t('common.edit')} aria-label={t('common.edit')} className="btn-icon h-8 w-8 text-brand-400 hover:bg-canvas">
                <IconEdit size={15} />
              </button>
              <button onClick={() => void remove(c.id)} title={t('common.delete')} aria-label={t('common.delete')} className="btn-icon h-8 w-8 text-brand-300 hover:bg-red-50 hover:text-red-600">
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

      {/* Düzenleme/ekleme formu — Parça Ekle pop-up'ıyla AYNI bileşen (CategoryEditForm). */}
      {draft && (
        <div className="mb-5 rounded-xl border border-line bg-canvas p-4">
          <CategoryEditForm key={draft.id} initial={draft} onDone={() => setDraft(null)} />
        </div>
      )}

      <div>
        {roots.map((c) => <Row key={c.id} c={c} depth={0} />)}
        {roots.length === 0 && <p className="py-6 text-center text-brand-400">{t('settings.categories.empty')}</p>}
      </div>
    </div>
  )
}
