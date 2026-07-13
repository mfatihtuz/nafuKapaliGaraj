import { useLiveQuery } from 'dexie-react-hooks'
import { AppHeader, Container } from '../components/Layout'
import { db } from '../db/dexie'
import { useAuth } from '../auth/AuthContext'
import { useT, LANGS } from '../i18n'
import { useSyncStatus } from '../sync/useSync'
import { useOutboxCount } from '../db/queries'
import { engine } from '../sync/engine'
import { getSyncErrors, clearSyncErrors, type SyncErrorLog } from '../sync/outbox'
import { formatDateTime } from '../lib/format'
import { IconSync, IconGlobe } from '../components/icons'

async function exportData() {
  const [parts, locations, categories, stock, transactions] = await Promise.all([
    db.parts.toArray(), db.locations.toArray(), db.categories.toArray(),
    db.stock.toArray(), db.transactions.toArray(),
  ])
  const blob = new Blob(
    [JSON.stringify({ exported_at: new Date().toISOString(), parts, locations, categories, stock, transactions }, null, 2)],
    { type: 'application/json' },
  )
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `depo-yedek-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

export function Settings() {
  const { t, lang, setLang } = useT()
  const { auth, logout } = useAuth()
  const status = useSyncStatus()
  const pending = useOutboxCount()
  const errors = useLiveQuery(async () => getSyncErrors(), [], [] as SyncErrorLog[])
  const partCount = useLiveQuery(() => db.parts.filter((p) => !p.deleted_at).count(), [], 0)
  const locCount = useLiveQuery(() => db.locations.filter((l) => !l.deleted_at).count(), [], 0)

  return (
    <>
      <AppHeader />
      <Container>
        <h1 className="mb-3 text-lg font-bold text-brand-800">{t('settings.title')}</h1>

        {/* Hesap */}
        <section className="card mb-3 p-4">
          <div className="field-label">{t('settings.account')}</div>
          <div className="text-sm text-brand-700">{auth?.user.display_name}</div>
          <div className="text-xs text-brand-400">{auth?.user.email} · {auth?.role}</div>
          <div className="mt-1 text-xs text-brand-400">{auth?.tenant.name}</div>
          <p className="mt-3 text-xs text-brand-400">
            {t('settings.counts', { parts: partCount, locations: locCount })}
          </p>
        </section>

        {/* Dil */}
        <section className="card mb-3 p-4">
          <div className="field-label flex items-center gap-1"><IconGlobe size={14} /> {t('settings.language')}</div>
          <div className="flex gap-1.5">
            {LANGS.map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`btn flex-1 uppercase ${lang === l ? 'bg-brand text-white' : 'bg-brand-50 text-brand-500'}`}
              >
                {l}
              </button>
            ))}
          </div>
        </section>

        {/* Senkronizasyon */}
        <section className="card mb-3 p-4">
          <div className="field-label">{t('settings.sync')}</div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-brand-500">{t('settings.pending_ops')}</span>
            <span className="font-semibold">{pending}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-brand-500">{t('settings.last_sync')}</span>
            <span>{status.lastSyncAt ? formatDateTime(new Date(status.lastSyncAt).toISOString()) : '—'}</span>
          </div>
          <button
            onClick={() => void engine.sync()}
            disabled={!status.online}
            className="btn-navy mt-3 w-full"
          >
            <IconSync size={18} className={status.syncing ? 'animate-spin' : ''} />
            {t('settings.force_sync')}
          </button>

          {errors.length > 0 && (
            <div className="mt-3">
              <div className="field-label text-red-600">{t('settings.errors')}</div>
              <ul className="max-h-40 overflow-auto text-xs text-red-700">
                {errors.map((e) => (
                  <li key={e.op_id} className="border-b border-red-100 py-1">
                    <span className="font-medium">{e.type}</span> — {e.message}
                  </li>
                ))}
              </ul>
              <button onClick={() => void clearSyncErrors()} className="btn-ghost mt-2 w-full text-sm">
                {t('settings.clear_errors')}
              </button>
            </div>
          )}
        </section>

        {/* Veri */}
        <section className="card mb-3 p-4">
          <div className="field-label">{t('settings.export')}</div>
          <button onClick={() => void exportData()} className="btn-ghost w-full">
            {t('settings.export')}
          </button>
        </section>

        <button onClick={() => void logout()} className="btn-danger w-full">
          {t('settings.danger')}
        </button>
      </Container>
    </>
  )
}
