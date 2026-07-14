import { NavLink } from 'react-router-dom'
import { navItemsFor } from './navItems'
import { useT } from '../i18n'
import { useAuth } from '../auth/AuthContext'
import { IconBox, IconLogout } from './icons'

const ROLE_LABEL: Record<string, string> = { owner: 'Yönetici', member: 'Üye', viewer: 'Misafir' }

/** Masaüstü kenar çubuğu (lg+). Mobilde gizli — bunun yerine alt navigasyon. */
export function Sidebar() {
  const { t } = useT()
  const { auth, logout, canWrite } = useAuth()
  const items = navItemsFor(canWrite)

  return (
    <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-brand-800 text-white lg:flex">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-brand-900">
          <IconBox size={20} />
        </span>
        <div className="leading-tight">
          <div className="text-[15px] font-bold tracking-tight">{t('app.title')}</div>
          <div className="text-[11px] text-white/50">{t('app.tagline')}</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {items.map(({ to, key, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `navitem ${isActive ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'}`
            }
          >
            {({ isActive }) => (
              <>
                <span className={isActive ? 'text-accent' : ''}><Icon size={20} /></span>
                {t(key)}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-bold">
            {(auth?.user.display_name ?? '?').slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-medium">{auth?.user.display_name}</div>
            <div className="truncate text-[11px] text-white/50">
              {ROLE_LABEL[auth?.role ?? 'member']}
            </div>
          </div>
          <button
            onClick={() => void logout()}
            className="btn-icon text-white/60 hover:bg-white/10 hover:text-white"
            title={t('auth.logout')}
          >
            <IconLogout size={18} />
          </button>
        </div>
      </div>
    </aside>
  )
}
