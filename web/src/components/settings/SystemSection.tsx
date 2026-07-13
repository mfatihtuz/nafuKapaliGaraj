import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/dexie'
import { useT, LANGS } from '../../i18n'
import { useSyncStatus } from '../../sync/useSync'
import { useOutboxCount } from '../../db/queries'
import { engine } from '../../sync/engine'
import { getSyncErrors, clearSyncErrors, type SyncErrorLog } from '../../sync/outbox'
import { formatDateTime } from '../../lib/format'
import { IconSync, IconGlobe, IconDatabase } from '../icons'

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

export function SystemSection() {
  const { t, lang, setLang } = useT()
  const status = useSyncStatus()
  const pending = useOutboxCount()
  const errors = useLiveQuery(async () => getSyncErrors(), [], [] as SyncErrorLog[])
  const partCount = useLiveQuery(() => db.parts.filter((p) => !p.deleted_at).count(), [], 0)
  const locCount = useLiveQuery(() => db.locations.filter((l) => !l.deleted_at).count(), [], 0)

  return (
    <div className="space-y-4">
      {/* Dil */}
      <div className="card card-pad">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-brand-800">
          <IconGlobe size={18} /> {t('settings.sections.language')}
        </h2>
        <div className="flex gap-2">
          {LANGS.map((l) => (
            <button key={l} onClick={() => setLang(l)}
              className={`btn flex-1 uppercase ${lang === l ? 'bg-brand-700 text-white' : 'bg-brand-50 text-brand-500'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Senkronizasyon */}
      <div className="card card-pad">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-brand-800">
          <IconSync size={18} /> {t('settings.sync.title')}
        </h2>
        <div className="flex items-center justify-between border-b border-line py-2 text-sm">
          <span className="text-brand-500">{t('settings.sync.pending')}</span>
          <span className="font-semibold">{pending}</span>
        </div>
        <div className="flex items-center justify-between py-2 text-sm">
          <span className="text-brand-500">{t('settings.sync.last')}</span>
          <span>{status.lastSyncAt ? formatDateTime(new Date(status.lastSyncAt).toISOString()) : '—'}</span>
        </div>
        <button onClick={() => void engine.sync()} disabled={!status.online} className="btn-navy mt-3 w-full">
          <IconSync size={17} className={status.syncing ? 'animate-spin' : ''} /> {t('settings.sync.force')}
        </button>
        {errors.length > 0 && (
          <div className="mt-4">
            <div className="section-title mb-1 text-red-600">{t('settings.sync.errors')}</div>
            <ul className="max-h-40 overflow-auto text-xs text-red-700">
              {errors.map((e) => <li key={e.op_id} className="border-b border-red-100 py-1">{e.type} — {e.message}</li>)}
            </ul>
            <button onClick={() => void clearSyncErrors()} className="btn-ghost mt-2 w-full text-sm">{t('settings.sync.clear')}</button>
          </div>
        )}
      </div>

      {/* Veri */}
      <div className="card card-pad">
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-brand-800">
          <IconDatabase size={18} /> {t('settings.data.title')}
        </h2>
        <p className="mb-3 text-sm text-brand-400">{t('settings.data.counts', { parts: partCount, locations: locCount })}</p>
        <button onClick={() => void exportData()} className="btn-ghost w-full">{t('settings.data.export')}</button>
      </div>
    </div>
  )
}
