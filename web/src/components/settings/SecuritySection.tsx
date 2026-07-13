import { useState } from 'react'
import { api, ApiError } from '../../sync/api'
import { useT } from '../../i18n'
import { useToast } from '../Toast'

export function SecuritySection() {
  const { t } = useT()
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)

  async function change() {
    if (next !== again) {
      toast.show(t('settings.security.mismatch'), 'error')
      return
    }
    setBusy(true)
    try {
      await api.changePassword(current, next)
      setCurrent(''); setNext(''); setAgain('')
      toast.show(t('settings.security.changed'), 'success')
    } catch (e) {
      const msg = e instanceof ApiError && e.status === 401 ? t('settings.security.wrong_current')
        : e instanceof ApiError ? e.message : 'Hata'
      toast.show(msg, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card card-pad">
      <h2 className="mb-4 text-base font-semibold text-brand-800">{t('settings.security.title')}</h2>
      <div className="grid max-w-md gap-4">
        <div>
          <label className="field-label">{t('settings.security.current')}</label>
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div>
          <label className="field-label">{t('settings.security.new')}</label>
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <div>
          <label className="field-label">{t('settings.security.new_again')}</label>
          <input className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <button onClick={() => void change()} disabled={busy || !current || !next} className="btn-primary">
          {t('settings.security.change')}
        </button>
      </div>
    </div>
  )
}
