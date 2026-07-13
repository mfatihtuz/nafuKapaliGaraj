import { NavLink } from 'react-router-dom'
import { useT } from '../i18n'
import { IconScan, IconSearch, IconPlus, IconTag, IconSettings } from './icons'
import type { ComponentType } from 'react'

interface Item {
  to: string
  key: string
  Icon: ComponentType<{ size?: number }>
}

const ITEMS: Item[] = [
  { to: '/scan', key: 'nav.scan', Icon: IconScan },
  { to: '/search', key: 'nav.search', Icon: IconSearch },
  { to: '/intake', key: 'nav.intake', Icon: IconPlus },
  { to: '/labels', key: 'nav.labels', Icon: IconTag },
  { to: '/settings', key: 'nav.settings', Icon: IconSettings },
]

export function BottomNav() {
  const { t } = useT()
  return (
    <nav
      className="no-print fixed bottom-0 inset-x-0 z-30 border-t border-mist bg-white/95 backdrop-blur"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
    >
      <div className="mx-auto flex max-w-lg">
        {ITEMS.map(({ to, key, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium transition-colors ${
                isActive ? 'text-accent-600' : 'text-brand-400'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`grid place-items-center rounded-xl px-3 py-1 transition-colors ${
                    isActive ? 'bg-accent/15' : ''
                  }`}
                >
                  <Icon size={22} />
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
