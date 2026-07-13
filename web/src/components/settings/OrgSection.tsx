import { useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { api, ApiError } from '../../sync/api'
import { useT } from '../../i18n'
import { useToast } from '../Toast'

export function OrgSection() {
  const { t } = useT()
  const { auth, refresh } = useAuth()
  const toast = useToast()
  const [name, setName] = useState(auth?.tenant.name ?? '')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await api.renameOrg(name)
      await refresh()
      toast.show(t('settings.org.saved'), 'success')
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : 'Hata', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card card-pad">
      <h2 className="mb-4 text-base font-semibold text-brand-800">{t('settings.org.title')}</h2>
      <div className="max-w-md">
        <label className="field-label">{t('settings.org.name')}</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="mt-5 flex justify-end">
        <button onClick={() => void save()} disabled={busy || !name.trim()} className="btn-primary">{t('common.save')}</button>
      </div>
    </div>
  )
}
