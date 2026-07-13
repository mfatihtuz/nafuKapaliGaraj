import { Outlet, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { BottomNav } from './BottomNav'
import { SyncBadge } from './SyncBadge'
import { IconBack } from './icons'
import { useT } from '../i18n'

interface HeaderProps {
  title?: ReactNode
  back?: boolean
  right?: ReactNode
}

export function AppHeader({ title, back, right }: HeaderProps) {
  const navigate = useNavigate()
  const { t } = useT()
  return (
    <header
      className="no-print sticky top-0 z-20 border-b border-brand-800 bg-brand text-white"
      style={{ paddingTop: 'var(--safe-top)' }}
    >
      <div className="mx-auto flex max-w-lg items-center gap-2 px-3 py-3">
        {back ? (
          <button
            onClick={() => navigate(-1)}
            className="btn-icon -ml-1 text-white/90 hover:bg-white/10"
            aria-label={t('common.back')}
          >
            <IconBack />
          </button>
        ) : (
          <div className="flex items-baseline gap-2 pl-1">
            <span className="text-lg font-extrabold tracking-tight">{t('app.title')}</span>
            <span className="hidden text-xs text-white/60 sm:inline">{t('app.tagline')}</span>
          </div>
        )}
        {title && <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h1>}
        <div className="ml-auto flex items-center gap-2">
          {right}
          <SyncBadge />
        </div>
      </div>
    </header>
  )
}

/** İçerik kapsayıcı (mobil-öncelikli, ortalı). */
export function Container({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-lg px-3 pb-24 pt-4">{children}</div>
}

/** Tüm oturumlu rotaları saran kabuk: içerik + sabit alt navigasyon. */
export function Layout() {
  return (
    <div className="min-h-screen">
      <Outlet />
      <BottomNav />
    </div>
  )
}
