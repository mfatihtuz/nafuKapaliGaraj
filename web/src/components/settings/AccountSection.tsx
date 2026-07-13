import { useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { api, ApiError } from '../../sync/api'
import { useT } from '../../i18n'
import { useToast } from '../Toast'

export function AccountSection() {
  const { t } = useT()
  const { auth, refresh } = useAuth()
  const toast = useToast()
  const [displayName, setDisplayName] = useState(auth?.user.display_name ?? '')
  const [username, setUsername] = useState(auth?.user.username ?? '')
  const [email, setEmail] = useState(auth?.user.email ?? '')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await api.updateProfile({
        display_name: displayName,
        username: username || undefined,
        email: email || undefined,
      })
      await refresh()
      toast.show(t('settings.account.saved'), 'success')
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : 'Hata', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card card-pad">
      <h2 className="mb-4 text-base font-semibold text-brand-800">{t('settings.account.title')}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="field-label">{t('settings.account.display_name')}</label>
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div>
          <label className="field-label">{t('settings.account.username')}</label>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" />
        </div>
        <div>
          <label className="field-label">{t('settings.account.email')}</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" />
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <button onClick={() => void save()} disabled={busy} className="btn-primary">{t('common.save')}</button>
      </div>
    </div>
  )
}
