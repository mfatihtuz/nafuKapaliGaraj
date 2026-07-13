import { Outlet, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { SyncBadge } from './SyncBadge'
import { IconBack } from './icons'
import { useT } from '../i18n'

interface HeaderProps {
  title?: ReactNode
  back?: boolean
  right?: ReactNode
}

/** Sayfa üst çubuğu — geri, başlık, sağ yuva + eşitleme rozeti. */
export function AppHeader({ title, back, right }: HeaderProps) {
  const navigate = useNavigate()
  const { t } = useT()
  return (
    <header
      className="no-print sticky top-0 z-20 border-b border-line bg-white/85 backdrop-blur"
      style={{ paddingTop: 'var(--safe-top)' }}
    >
      <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
        {back && (
          <button
            onClick={() => navigate(-1)}
            className="btn-icon -ml-1.5 text-brand-500 hover:bg-canvas"
            aria-label={t('common.back')}
          >
            <IconBack size={20} />
          </button>
        )}
        {title && <h1 className="min-w-0 flex-1 truncate text-[17px] font-semibold text-brand-800">{title}</h1>}
        {!title && <span className="flex-1" />}
        <div className="flex items-center gap-2">
          {right}
          <SyncBadge />
        </div>
      </div>
    </header>
  )
}

/** İçerik kapsayıcı. wide=true daha geniş (ayarlar gibi çok sütunlu sayfalar). */
export function Container({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className={`mx-auto ${wide ? 'max-w-5xl' : 'max-w-3xl'} px-4 pb-24 pt-5 lg:pb-10`}>{children}</div>
  )
}

/** Oturumlu rotaların kabuğu: masaüstü kenar çubuğu + içerik + mobil alt navigasyon. */
export function Layout() {
  return (
    <div className="min-h-screen">
      <Sidebar />
      <div className="lg:pl-64">
        <Outlet />
      </div>
      <BottomNav />
    </div>
  )
}
