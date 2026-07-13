import { useSyncStatus } from '../sync/useSync'
import { useOutboxCount } from '../db/queries'
import { useT } from '../i18n'
import { IconSync, IconWifiOff, IconCheck } from './icons'

export function SyncBadge() {
  const s = useSyncStatus()
  const pending = useOutboxCount()
  const { t } = useT()

  if (!s.online) {
    return (
      <span className="chip bg-red-100 text-red-700">
        <IconWifiOff size={14} /> {t('sync.offline')}
        {pending > 0 && ` · ${t('sync.pending', { n: pending })}`}
      </span>
    )
  }
  if (s.syncing) {
    return (
      <span className="chip bg-brand-50 text-brand-600">
        <IconSync size={14} className="animate-spin" /> {t('sync.syncing')}
      </span>
    )
  }
  if (s.authExpired) {
    return <span className="chip bg-red-100 text-red-700">{t('sync.auth_expired')}</span>
  }
  if (pending > 0) {
    return (
      <span className="chip bg-amber-100 text-amber-800">
        <IconSync size={14} /> {t('sync.pending', { n: pending })}
      </span>
    )
  }
  return (
    <span className="chip bg-green-100 text-green-800">
      <IconCheck size={14} /> {t('sync.synced')}
    </span>
  )
}
