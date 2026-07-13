import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useT } from '../i18n'
import { ApiError } from '../sync/api'
import { IconBox } from '../components/icons'

export function Login() {
  const { login } = useAuth()
  const { t } = useT()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email.trim(), password)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError(t('auth.wrong'))
      else if (err instanceof TypeError) setError(t('auth.offline_hint'))
      else setError(err instanceof Error ? err.message : t('auth.wrong'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-brand px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-white">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent text-brand-900">
            <IconBox size={34} />
          </div>
          <div className="text-center">
            <div className="text-2xl font-extrabold tracking-tight">{t('app.title')}</div>
            <div className="text-sm text-white/60">{t('app.tagline')}</div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="card flex flex-col gap-4 p-6">
          <h1 className="text-lg font-bold text-brand-800">{t('auth.login_title')}</h1>
          <div>
            <label className="field-label" htmlFor="email">{t('auth.email')}</label>
            <input
              id="email" type="email" autoComplete="username" required
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="input" placeholder="ornek@eposta.com"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="password">{t('auth.password')}</label>
            <input
              id="password" type="password" autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="input" placeholder="••••••••"
            />
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? t('auth.logging_in') : t('auth.login')}
          </button>
          <p className="text-center text-xs text-brand-400">{t('auth.offline_hint')}</p>
        </form>
      </div>
    </div>
  )
}
