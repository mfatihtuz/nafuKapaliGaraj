import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppHeader, Container } from '../components/Layout'
import { useProjects, useBomItems, useProjectFeasibility } from '../db/queries'
import { saveProject } from '../db/actions'
import type { Project, ProjectStatus } from '../db/types'
import { useT } from '../i18n'
import { useToast } from '../components/Toast'
import { useAuth } from '../auth/AuthContext'
import { IconProject, IconPlus, IconCheck, IconLoan } from '../components/icons'

const STATUS_ORDER: ProjectStatus[] = ['active', 'planned', 'done', 'archived']

function StatusBadge({ status }: { status: ProjectStatus }) {
  const { t } = useT()
  const cls =
    status === 'active' ? 'bg-green-100 text-green-800'
    : status === 'planned' ? 'bg-amber-100 text-amber-800'
    : status === 'done' ? 'bg-brand-100 text-brand-600'
    : 'bg-brand-50 text-brand-400'
  return <span className={`chip text-[11px] font-semibold ${cls}`}>{t(`project.status.${status}`)}</span>
}

/** Kart alt bandı: BOM satır sayısı + feasibility özeti (canlı). */
function ProjectCardMeta({ id }: { id: string }) {
  const { t } = useT()
  const boms = useBomItems(id)
  const feas = useProjectFeasibility(id)
  if (boms.length === 0) return <span className="text-xs text-brand-300">{t('project.no_bom')}</span>
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-brand-400">{t('project.bom_count', { n: boms.length })}</span>
      {feas.canBuild ? (
        <span className="chip bg-green-50 font-semibold text-green-700"><IconCheck size={12} /> {t('project.buildable')}</span>
      ) : (
        <span className="chip bg-red-50 font-semibold text-red-700">
          {t('project.short_count', { n: feas.shortages.length + feas.unmatched.length })}
        </span>
      )}
    </div>
  )
}

export function Projects() {
  const { t } = useT()
  const toast = useToast()
  const { canWrite } = useAuth()
  const projects = useProjects()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const groups = useMemo(() => {
    const map = new Map<ProjectStatus, Project[]>()
    for (const p of projects) {
      if (!map.has(p.status)) map.set(p.status, [])
      map.get(p.status)!.push(p)
    }
    return STATUS_ORDER.filter((s) => map.has(s)).map((s) => [s, map.get(s)!] as const)
  }, [projects])

  async function create() {
    const nm = name.trim()
    if (!nm) return
    setBusy(true)
    try {
      await saveProject({ name: nm, status: 'planned' })
      toast.show(t('project.created'), 'success')
      setName(''); setCreating(false)
    } finally { setBusy(false) }
  }

  return (
    <>
      <AppHeader title={t('nav.projects')} right={
        <div className="flex items-center gap-2">
          <Link to="/loans" title={t('loan.page_title')} aria-label={t('loan.page_title')}
            className="btn-ghost h-9 px-3 text-sm">
            <IconLoan size={16} /> <span className="hidden sm:inline">{t('loan.page_title')}</span>
          </Link>
          {canWrite && (
            <button onClick={() => setCreating((v) => !v)} className="btn-primary h-9 px-3 text-sm">
              <IconPlus size={16} /> {t('project.new')}
            </button>
          )}
        </div>
      } />
      <Container>
        {creating && (
          <div className="card card-pad mb-3">
            <label className="field-label">{t('project.name')}</label>
            <div className="flex gap-2">
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void create() }}
                placeholder={t('project.name_placeholder')} className="input" />
              <button onClick={() => void create()} disabled={busy || !name.trim()} className="btn-navy px-4 disabled:opacity-50">
                {t('common.save')}
              </button>
            </div>
          </div>
        )}

        {projects.length === 0 ? (
          <div className="card card-pad mt-6 text-center">
            <IconProject size={30} className="mx-auto mb-2 text-brand-300" />
            <p className="text-brand-500">{t('project.empty')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map(([status, list]) => (
              <div key={status}>
                <div className="section-title mb-1.5 flex items-center gap-2">
                  {t(`project.status.${status}`)} <span className="text-brand-300">({list.length})</span>
                </div>
                <div className="space-y-2">
                  {list.map((p) => (
                    <Link key={p.id} to={`/projects/${p.id}`}
                      className="card flex items-center justify-between gap-2 p-3 transition-colors hover:border-accent">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-brand-800">{p.name}</div>
                        <div className="mt-1"><ProjectCardMeta id={p.id} /></div>
                      </div>
                      <StatusBadge status={p.status} />
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Container>
    </>
  )
}
