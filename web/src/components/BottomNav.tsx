import { NavLink } from 'react-router-dom'
import { useT } from '../i18n'
import { NAV_ITEMS } from './navItems'

/** Mobil alt navigasyon (lg altında). Masaüstünde kenar çubuğu kullanılır. */
export function BottomNav() {
  const { t } = useT()
  return (
    <nav
      className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
    >
      <div className="mx-auto flex max-w-md">
        {NAV_ITEMS.map(({ to, key, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${
                isActive ? 'text-accent-700' : 'text-brand-400'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`grid place-items-center rounded-lg px-4 py-1 transition-colors ${isActive ? 'bg-accent/15' : ''}`}>
                  <Icon size={21} />
                </span>
                {t(key)}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
