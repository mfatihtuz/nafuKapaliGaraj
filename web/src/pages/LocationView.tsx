import { Link, useNavigate, useParams } from 'react-router-dom'
import { AppHeader, Container } from '../components/Layout'
import { useLocationByCode, useStockAtLocation, useLocations } from '../db/queries'
import { StockControl } from '../components/StockControl'
import { useT } from '../i18n'
import { useAuth } from '../auth/AuthContext'
import { IconPlus, IconChevronRight, IconFolder } from '../components/icons'

const SYSTEM_TYPES = ['intake', 'bench', 'quarantine', 'loan', 'project']

export function LocationView() {
  const { code = '' } = useParams()
  const { t } = useT()
  const { canWrite } = useAuth()
  const navigate = useNavigate()
  const location = useLocationByCode(code)
  const items = useStockAtLocation(location?.id)
  const allLocations = useLocations()
  // Dolap/modül gibi grup konumları: alt konumları listelenir, doğrudan parça almaz.
  const children = allLocations
    .filter((l) => l.parent_id === location?.id)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
  const isGroup = children.length > 0

  if (location === undefined) {
    return (
      <>
        <AppHeader back title={code} />
        <Container><p className="py-16 text-center text-brand-400">{t('common.loading')}</p></Container>
      </>
    )
  }

  if (location === null) {
    return (
      <>
        <AppHeader back title={code} />
        <Container>
          <div className="card p-8 text-center">
            <p className="text-lg font-semibold text-brand-700">{t('location.not_found')}</p>
            <p className="mt-1 font-mono text-2xl font-extrabold text-brand-300">{code}</p>
          </div>
        </Container>
      </>
    )
  }

  const isSystem = SYSTEM_TYPES.includes(location.type)

  return (
    <>
      <AppHeader back />
      <Container>
        {/* Büyük konum kodu — uzaktan okunabilir (PRD §5.2) */}
        <div className="card mb-4 flex items-center justify-between p-5">
          <div>
            <div className="loc-code text-4xl">{location.code}</div>
            {location.name && <div className="mt-1 text-sm text-brand-400">{location.name}</div>}
          </div>
          {isSystem && (
            <span className="chip bg-brand-50 text-brand-500">{t('location.system')}</span>
          )}
        </div>

        {/* Grup konumu (dolap/modül): alt konumları listele — "boş çekmece" yanılgısı olmasın */}
        {isGroup ? (
          <div className="flex flex-col gap-1.5">
            <div className="section-title mb-1 flex items-center gap-1.5">
              <IconFolder size={13} /> {t('location.sublocations', { n: children.length })}
            </div>
            {children.map((child) => (
              <Link
                key={child.id}
                to={`/l/${encodeURIComponent(child.code)}`}
                className="card flex items-center justify-between p-3 transition-colors hover:border-accent"
              >
                <span className="loc-code text-lg">{child.code}</span>
                <span className="flex items-center gap-2 text-sm text-brand-400">
                  {child.name}
                  <IconChevronRight size={16} className="text-brand-300" />
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {items.length === 0 ? (
              <p className="py-10 text-center text-brand-400">{t('location.empty')}</p>
            ) : (
              items.map(({ stock, part }) => (
                <div key={part.id} className="card flex items-center gap-3 p-3">
                  <button
                    onClick={() => navigate(`/parts/${part.id}`)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate font-semibold text-brand-800">{part.name}</div>
                    <div className="truncate font-mono text-xs text-brand-400">{part.sku}</div>
                  </button>
                  <StockControl part={part} stock={stock} locationId={location.id} />
                </div>
              ))
            )}
          </div>
        )}

        {/* Parça yalnızca yaprak konuma eklenir — grup görünümünde buton yok. */}
        {canWrite && !isGroup && (
          <button
            onClick={() => navigate(`/intake?location=${encodeURIComponent(location.code)}`)}
            className="btn-primary mt-4 w-full"
          >
            <IconPlus size={20} />
            {t('location.add_part')}
          </button>
        )}

        <Link to="/search" className="mt-3 flex items-center justify-center gap-1 text-sm text-brand-400">
          {t('nav.search')} <IconChevronRight size={16} />
        </Link>
      </Container>
    </>
  )
}
