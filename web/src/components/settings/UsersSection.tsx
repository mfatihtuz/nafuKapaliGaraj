import { useEffect, useState } from 'react'
import { api, ApiError, type OrgUser } from '../../sync/api'
import { useAuth } from '../../auth/AuthContext'
import { useT } from '../../i18n'
import { useToast } from '../Toast'
import { IconPlus, IconTrash, IconUsers, IconKey } from '../icons'

const ROLES = ['owner', 'member', 'viewer'] as const

function RoleBadge({ role }: { role: string }) {
  const { t } = useT()
  const cls = role === 'owner' ? 'badge-owner' : role === 'member' ? 'badge-member' : 'badge-viewer'
  return <span className={cls}>{t(`settings.roles.${role}`)}</span>
}

export function UsersSection() {
  const { t } = useT()
  const { auth } = useAuth()
  const toast = useToast()
  const [users, setUsers] = useState<OrgUser[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ display_name: '', username: '', email: '', password: '', role: 'member' })
  const [busy, setBusy] = useState(false)
  const [resetId, setResetId] = useState<string | null>(null)
  const [resetPw, setResetPw] = useState('')

  async function doReset(id: string) {
    if (resetPw.trim().length < 8) { toast.show(t('settings.users.pw_min'), 'error'); return }
    try {
      await api.resetUserPassword(id, resetPw.trim())
      toast.show(t('settings.users.pw_reset_done'), 'success')
      setResetId(null); setResetPw('')
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : 'Hata', 'error')
    }
  }

  async function load() {
    try {
      const r = await api.listUsers()
      setUsers(r.users)
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : 'Hata', 'error')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

  async function create() {
    setBusy(true)
    try {
      await api.createUser(form)
      setForm({ display_name: '', username: '', email: '', password: '', role: 'member' })
      setAdding(false)
      toast.show(t('settings.users.created'), 'success')
      await load()
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : 'Hata', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function changeRole(id: string, role: string) {
    try {
      await api.setUserRole(id, role)
      await load()
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : 'Hata', 'error')
    }
  }

  async function remove(id: string) {
    if (!confirm(t('settings.users.remove_confirm'))) return
    try {
      await api.removeUser(id)
      await load()
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : 'Hata', 'error')
    }
  }

  return (
    <div className="card card-pad">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-brand-800">{t('settings.users.title')}</h2>
          <p className="text-sm text-brand-400">{t('settings.users.subtitle')}</p>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} className="btn-primary">
            <IconPlus size={18} /> {t('settings.users.add')}
          </button>
        )}
      </div>

      {adding && (
        <div className="mb-5 rounded-xl border border-line bg-canvas p-4">
          <h3 className="mb-3 text-sm font-semibold text-brand-700">{t('settings.users.add_title')}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label">{t('settings.users.name')}</label>
              <input className="input" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
            </div>
            <div>
              <label className="field-label">{t('settings.users.username')}</label>
              <input className="input" autoCapitalize="none" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div>
              <label className="field-label">{t('settings.users.email')}</label>
              <input className="input" type="email" autoCapitalize="none" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="field-label">{t('settings.users.password')}</label>
              <input className="input" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="field-label">{t('settings.users.role')}</label>
              <div className="flex flex-wrap gap-2">
                {ROLES.map((r) => (
                  <button
                    key={r}
                    onClick={() => setForm({ ...form, role: r })}
                    className={`chip px-3 py-1.5 ${form.role === r ? 'bg-brand-700 text-white' : 'bg-brand-50 text-brand-600'}`}
                  >
                    {t(`settings.roles.${r}`)}
                  </button>
                ))}
              </div>
              <p className="field-hint">{t(`settings.roles.${form.role}_hint`)}</p>
            </div>
          </div>
          {!form.username.trim() && !form.email.trim() && (
            <p className="mt-2 text-xs text-amber-600">{t('settings.users.need_login')}</p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="btn-ghost">{t('common.cancel')}</button>
            <button
              onClick={() => void create()}
              disabled={busy || !form.display_name.trim() || form.password.length < 8 || (!form.username.trim() && !form.email.trim())}
              className="btn-primary"
            >
              {t('settings.users.create')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="py-6 text-center text-brand-400">{t('common.loading')}</p>
      ) : (
        <div>
          {users.map((u) => {
            const isMe = u.id === auth?.user.id
            return (
              <div key={u.id}>
              <div className="row">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-bold text-brand-500">
                  {u.display_name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-brand-800">{u.display_name}</span>
                    {isMe && <span className="text-xs text-brand-300">({t('settings.users.you')})</span>}
                  </div>
                  <div className="truncate text-xs text-brand-400">{u.username ? '@' + u.username : u.email}</div>
                </div>
                {isMe ? (
                  <RoleBadge role={u.role} />
                ) : (
                  <select
                    className="select h-9 w-28 px-2 text-sm"
                    value={u.role}
                    onChange={(e) => void changeRole(u.id, e.target.value)}
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{t(`settings.roles.${r}`)}</option>)}
                  </select>
                )}
                {!isMe && (
                  <button onClick={() => { setResetId(resetId === u.id ? null : u.id); setResetPw('') }} title={t('settings.users.reset_pw')} aria-label={t('settings.users.reset_pw')} className="btn-icon text-brand-300 hover:bg-brand-50 hover:text-brand-700">
                    <IconKey size={16} />
                  </button>
                )}
                {!isMe && (
                  <button onClick={() => void remove(u.id)} title={t('settings.users.remove')} aria-label={t('settings.users.remove')} className="btn-icon text-brand-300 hover:bg-red-50 hover:text-red-600">
                    <IconTrash size={17} />
                  </button>
                )}
              </div>
              {resetId === u.id && (
                <div className="mb-2 ml-12 flex items-center gap-2 rounded-lg bg-brand-50 p-2">
                  <input
                    autoFocus type="text" value={resetPw} onChange={(e) => setResetPw(e.target.value)}
                    placeholder={t('settings.users.temp_pw')} className="input h-9 flex-1"
                  />
                  <button onClick={() => void doReset(u.id)} className="btn-primary h-9 px-3 text-sm">{t('settings.users.reset_pw')}</button>
                  <button onClick={() => setResetId(null)} className="btn-ghost h-9 px-2 text-sm">{t('common.cancel')}</button>
                </div>
              )}
            </div>
            )
          })}
          {users.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-brand-300">
              <IconUsers size={28} /> <span className="text-sm">—</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
