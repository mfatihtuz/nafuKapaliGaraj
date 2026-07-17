import { useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AppHeader, Container } from '../components/Layout'
import {
  useProject, useBomItems, useProjectFeasibility, useStockAtLocation, useParts,
} from '../db/queries'
import { db } from '../db/dexie'
import {
  saveProject, softDeleteProject, saveBomItemsBulk, saveBomItem, deleteBomItem,
  pullToProject, returnFromProject, consumeInProject,
} from '../db/actions'
import type { Part, ProjectStatus, BomItem, Stock } from '../db/types'
import { isFreeStock } from '../lib/freeStock'
import { buildBomPlan, type BomPlan } from '../lib/bomImport'
import { searchMatch } from '../lib/normalize'
import { formatQty, unitLabel } from '../lib/format'
import { useT } from '../i18n'
import { useToast } from '../components/Toast'
import { useAuth } from '../auth/AuthContext'
import { IconCheck, IconBack, IconTrash, IconUpload, IconX } from '../components/icons'

const STATUSES: ProjectStatus[] = ['planned', 'active', 'done', 'archived']

/** Bir parçanın SERBEST konumlardaki stok satırları (en dolu → en boş) + doluluk kaynağı. */
async function freeStockOf(part: Part): Promise<{ rows: Stock[]; bestLevel: Stock | null }> {
  const rows = await db.stock.where('part_id').equals(part.id).toArray()
  const locs = await db.locations.toArray()
  const byId = new Map(locs.map((l) => [l.id, l]))
  const free = rows.filter((s) => isFreeStock(byId.get(s.location_id)))
  const withQty = free.filter((s) => Number(s.qty) > 0).sort((a, b) => Number(b.qty) - Number(a.qty))
  const bestLevel = free.filter((s) => s.level === 'full' || s.level === 'low')[0] ?? null
  return { rows: withQty, bestLevel }
}

// --- "Yapabilir miyim?" bandı (salt-özet) -----------------------------------
function FeasibilityBand({ projectId }: { projectId: string }) {
  const { t } = useT()
  const feas = useProjectFeasibility(projectId)
  if (feas.lines.length === 0) return null

  return (
    <div className={`card card-pad ${feas.canBuild ? 'border-green-200 bg-green-50/40' : 'border-red-200 bg-red-50/30'}`}>
      {feas.canBuild ? (
        <p className="flex items-center gap-2 text-base font-bold text-green-700">
          <IconCheck size={20} /> {t('project.buildable_long')}
        </p>
      ) : (
        <>
          <p className="mb-2 text-base font-bold text-red-700">{t('project.not_buildable')}</p>
          <div className="space-y-1.5">
            {feas.shortages.map((l) => (
              <div key={l.bom.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-brand-700">{l.part?.name ?? l.bom.raw_value ?? '—'}</span>
                <span className="shrink-0 tabular-nums text-red-600">{t('project.have_need', { have: l.have, need: l.need })}</span>
              </div>
            ))}
            {feas.unmatched.length > 0 && (
              <p className="pt-1 text-xs text-amber-700">{t('project.unmatched_warn', { n: feas.unmatched.length })}</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// --- Parça seçici (elle eşleştirme) ----------------------------------------
function PartPicker({ onPick, onClose }: { onPick: (p: Part) => void; onClose: () => void }) {
  const { t } = useT()
  const parts = useParts()
  const [q, setQ] = useState('')
  const hits = useMemo(
    () => (q.trim() === '' ? [] : parts.filter((p) => !p.deleted_at && searchMatch(q, p.name, p.sku, p.mpn, p.tags)).slice(0, 20)),
    [q, parts],
  )
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-canvas p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-semibold text-brand-800">{t('project.pick_part')}</h3>
          <button onClick={onClose} className="btn-icon h-8 w-8"><IconX size={18} /></button>
        </div>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.search_placeholder')} className="input" />
        <div className="mt-2 max-h-72 overflow-auto">
          {hits.map((p) => (
            <button key={p.id} onClick={() => onPick(p)} className="flex w-full items-center justify-between border-b border-line py-2 text-left hover:bg-brand-50">
              <span className="min-w-0 truncate text-sm text-brand-700">{p.name}</span>
              <span className="ml-2 shrink-0 font-mono text-xs text-brand-400">{p.sku}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// --- BOM bölümü (içe aktarma + liste + elle eşleştirme + projeye çek) -------
function BomSection({ projectId, projectLocationId }: { projectId: string; projectLocationId: string | null }) {
  const { t } = useT()
  const toast = useToast()
  const { canWrite } = useAuth()
  const boms = useBomItems(projectId)
  const parts = useParts()
  const partById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts])
  const fileRef = useRef<HTMLInputElement>(null)
  const [plan, setPlan] = useState<BomPlan | null>(null)
  const [text, setText] = useState('')
  const [matchFor, setMatchFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Bir BOM kalemini projeye çek: gereken adedi BİRDEN ÇOK serbest çekmeceden topla
  // (en dolu → en boş); fiilen çekilen miktarı dürüstçe bildir (eksikse uyar — bulgu #2).
  async function pull(part: Part, needed: number) {
    if (!projectLocationId) return
    setBusy(true)
    try {
      const fs = await freeStockOf(part)
      if (part.count_mode === 'level') {
        if (!fs.bestLevel) { toast.show(t('project.no_free_stock'), 'error'); return }
        await pullToProject(part, fs.bestLevel.location_id, projectLocationId, 0, projectId, fs.bestLevel.level)
        toast.show(t('project.pulled'), 'success')
        return
      }
      let remaining = needed, pulled = 0
      for (const s of fs.rows) {
        if (remaining <= 0) break
        const take = Math.min(remaining, Number(s.qty))
        await pullToProject(part, s.location_id, projectLocationId, take, projectId)
        remaining -= take; pulled += take
      }
      if (pulled === 0) toast.show(t('project.no_free_stock'), 'error')
      else if (pulled < needed) toast.show(t('project.pulled_partial', { pulled, needed }), 'info')
      else toast.show(t('project.pulled'), 'success')
    } catch {
      toast.show(t('common.error'), 'error') // sessiz başarısızlık olmasın (bulgu #14)
    } finally { setBusy(false) }
  }

  function analyze(src: string) {
    setText(src)
    setPlan(src.trim() === '' ? null : buildBomPlan(src, parts.filter((p) => !p.deleted_at)))
  }
  function onFile(f: File | undefined) {
    if (!f) return
    const rd = new FileReader()
    rd.onload = () => analyze(String(rd.result ?? ''))
    rd.readAsText(f, 'utf-8')
  }
  async function doImport() {
    if (!plan) return
    await saveBomItemsBulk(projectId, plan.rows.map((r) => r.draft), true)
    toast.show(t('project.bom_imported', { n: plan.rows.length }), 'success')
    setPlan(null); setText('')
    if (fileRef.current) fileRef.current.value = ''
  }
  async function assign(bom: BomItem, part: Part) {
    await saveBomItem({ ...bom, part_id: part.id })
    setMatchFor(null)
    toast.show(t('project.matched'), 'success')
  }

  return (
    <div className="card card-pad">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-semibold text-brand-800">{t('project.bom')}</h2>
        {canWrite && (
          <button onClick={() => fileRef.current?.click()} className="btn-ghost h-8 px-2 text-sm">
            <IconUpload size={15} /> {t('project.bom_import')}
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />

      {canWrite && (
        <textarea value={text} onChange={(e) => analyze(e.target.value)} rows={3}
          placeholder={t('project.bom_placeholder')}
          className="mb-2 w-full rounded-xl border border-line bg-canvas p-2 font-mono text-xs text-brand-700" spellCheck={false} />
      )}

      {plan && (
        <div className="mb-3 rounded-lg border border-line p-2">
          <p className="mb-1 text-xs text-brand-500">
            {t('project.bom_plan', { total: plan.rows.length, matched: plan.matched, unmatched: plan.unmatched })}
          </p>
          <button onClick={() => void doImport()} className="btn-navy w-full text-sm">
            {t('project.bom_replace', { n: plan.rows.length })}
          </button>
        </div>
      )}

      {boms.length === 0 ? (
        <p className="py-3 text-center text-sm text-brand-300">{t('project.no_bom')}</p>
      ) : (
        <div className="space-y-1">
          {boms.map((b) => {
            const part = b.part_id ? partById.get(b.part_id) : undefined
            return (
              <div key={b.id} className="flex items-center justify-between gap-2 border-b border-line py-1.5 text-sm">
                <div className="min-w-0">
                  <div className="truncate text-brand-700">
                    {part ? part.name : (b.raw_value || b.raw_mpn || b.raw_ref || '—')}
                    {!part && <span className="ml-1 text-[11px] text-amber-600">({t('project.unmatched')})</span>}
                  </div>
                  <div className="truncate text-[11px] text-brand-400">
                    {[b.raw_ref, b.raw_value, b.raw_footprint].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums text-xs text-brand-500">×{b.qty_needed}</span>
                  {canWrite && part && projectLocationId && (
                    <button onClick={() => void pull(part, Number(b.qty_needed))} disabled={busy}
                      className="btn-ghost h-7 px-2 text-xs disabled:opacity-40">{t('project.pull')}</button>
                  )}
                  {canWrite && (
                    <>
                      <button onClick={() => setMatchFor(b.id)} className="text-xs text-accent hover:underline">{t('project.match')}</button>
                      <button onClick={() => void deleteBomItem(b.id)} className="btn-icon h-7 w-7 text-brand-300"><IconTrash size={13} /></button>
                    </>
                  )}
                </div>
                {matchFor === b.id && <PartPicker onPick={(p) => void assign(b, p)} onClose={() => setMatchFor(null)} />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// --- Proje gözü içeriği (iade / tüket) --------------------------------------
function ProjectContents({ project }: { project: { id: string; location_id: string | null } }) {
  const { t } = useT()
  const toast = useToast()
  const { canWrite } = useAuth()
  const contents = useStockAtLocation(project.location_id ?? undefined)
  // Çift-dokunuş kilidi (mobil/tek-el): işlenen parça id'si → aynı satıra ikinci kez basıp
  // proje gözünü negatife düşürmek / hedefte hayalet stok üretmek engellenir (bulgu #1).
  const [busyId, setBusyId] = useState<string | null>(null)

  async function ret(part: Part, stock: Stock) {
    if (!project.location_id || busyId) return
    setBusyId(part.id)
    try {
      // İade: parçanın çekildiği serbest bir çekmeceye (en dolusu) geri gönder; yoksa uyar.
      const rows = await db.stock.where('part_id').equals(part.id).toArray()
      const locs = await db.locations.toArray(); const byId = new Map(locs.map((l) => [l.id, l]))
      const target = rows.filter((s) => s.location_id !== project.location_id && isFreeStock(byId.get(s.location_id)))
        .sort((a, b) => Number(b.qty) - Number(a.qty))[0]
      if (!target) { toast.show(t('project.no_return_target'), 'error'); return }
      if (part.count_mode === 'level') await returnFromProject(part, project.location_id, target.location_id, 0, project.id, stock.level)
      else await returnFromProject(part, project.location_id, target.location_id, Number(stock.qty), project.id)
      toast.show(t('project.returned'), 'success')
    } catch { toast.show(t('common.error'), 'error') } finally { setBusyId(null) }
  }
  async function use(part: Part, stock: Stock) {
    if (!project.location_id || busyId) return
    setBusyId(part.id)
    try {
      await consumeInProject(part, project.location_id, Number(stock.qty), project.id)
      toast.show(t('project.consumed'), 'success')
    } catch { toast.show(t('common.error'), 'error') } finally { setBusyId(null) }
  }

  if (contents.length === 0) return null
  return (
    <div className="card card-pad">
      <h2 className="mb-2 text-base font-semibold text-brand-800">{t('project.contents')}</h2>
      <div className="space-y-1.5">
        {contents.map(({ part, stock }) => (
          <div key={part.id} className="flex items-center justify-between gap-2 border-b border-line py-1.5 text-sm">
            <span className="min-w-0 truncate text-brand-700">{part.name}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="tabular-nums text-brand-600">
                {part.count_mode === 'exact' ? formatQty(Number(stock.qty), unitLabel(t, part.unit)) : ''}
              </span>
              {canWrite && (
                <>
                  <button disabled={!!busyId} onClick={() => void ret(part, stock)} className="text-xs text-accent hover:underline disabled:opacity-40">{t('project.return')}</button>
                  <button disabled={!!busyId} onClick={() => void use(part, stock)} className="text-xs text-red-600 hover:underline disabled:opacity-40">{t('project.consume')}</button>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProjectDetail() {
  const { id = '' } = useParams()
  const { t } = useT()
  const toast = useToast()
  const navigate = useNavigate()
  const { canWrite } = useAuth()
  const project = useProject(id)

  if (project === undefined) return <><AppHeader back /><Container><p className="py-12 text-center text-brand-400">{t('common.loading')}</p></Container></>
  if (project === null) return <><AppHeader back /><Container><p className="py-12 text-center text-brand-400">{t('project.not_found')}</p></Container></>

  async function setStatus(status: ProjectStatus) {
    await saveProject({ id: project!.id, name: project!.name, status })
  }
  async function archive() {
    if (!confirm(t('project.archive_confirm'))) return
    try {
      await softDeleteProject(project!.id)
      toast.show(t('project.archived'), 'success')
      navigate('/projects')
    } catch (e) {
      toast.show(e instanceof Error && e.message === 'PROJECT_HAS_STOCK' ? t('project.has_stock') : t('common.error'), 'error')
    }
  }

  return (
    <>
      <AppHeader back title={project.name} right={
        <button onClick={() => navigate('/projects')} className="btn-icon h-9 w-9 text-brand-500"><IconBack size={18} /></button>
      } />
      <Container>
        <div className="space-y-3">
          {/* Durum + arşiv */}
          {canWrite && (
            <div className="card card-pad flex flex-wrap items-center gap-2">
              <span className="text-sm text-brand-500">{t('project.status_label')}:</span>
              <div className="flex gap-1">
                {STATUSES.map((s) => (
                  <button key={s} onClick={() => void setStatus(s)}
                    className={`btn h-8 px-2 text-xs ${project.status === s ? 'bg-brand-700 text-white' : 'bg-brand-50 text-brand-500'}`}>
                    {t(`project.status.${s}`)}
                  </button>
                ))}
              </div>
              <button onClick={() => void archive()} className="btn-ghost ml-auto h-8 px-2 text-xs text-red-600">
                <IconTrash size={14} /> {t('project.archive')}
              </button>
            </div>
          )}

          <FeasibilityBand projectId={project.id} />
          <BomSection projectId={project.id} projectLocationId={project.location_id} />
          <ProjectContents project={project} />
        </div>
      </Container>
    </>
  )
}
