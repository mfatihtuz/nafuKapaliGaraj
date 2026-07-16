import { Suspense, Component, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import { Layout } from './components/Layout'
import { Login } from './pages/Login'
import { lazyReload } from './lib/lazyReload'
import { useT } from './i18n'

// Rota-bazlı kod bölme — açılışta yalnızca kabuk yüklenir (ARCHITECTURE §7).
// lazyReload: yeni dağıtım sonrası eski önbellekte chunk bulunamazsa donmak yerine
// bir kez otomatik yeniler (bkz. lib/lazyReload.ts).
const Scan = lazyReload(() => import('./pages/Scan').then((m) => ({ default: m.Scan })))
const Search = lazyReload(() => import('./pages/Search').then((m) => ({ default: m.Search })))
const Intake = lazyReload(() => import('./pages/Intake').then((m) => ({ default: m.Intake })))
const Labels = lazyReload(() => import('./pages/Labels').then((m) => ({ default: m.Labels })))
const Settings = lazyReload(() => import('./pages/Settings').then((m) => ({ default: m.Settings })))
const LocationView = lazyReload(() => import('./pages/LocationView').then((m) => ({ default: m.LocationView })))
const PartDetail = lazyReload(() => import('./pages/PartDetail').then((m) => ({ default: m.PartDetail })))
const Shopping = lazyReload(() => import('./pages/Shopping').then((m) => ({ default: m.Shopping })))

const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, '')

function Splash() {
  const { t } = useT()
  return (
    <div className="grid min-h-screen place-items-center bg-brand text-white/70">
      {t('common.loading')}
    </div>
  )
}

/**
 * Bir chunk yüklenemez (dağıtım sonrası eski önbellek) ya da bir ekran çökerse,
 * donmuş "Yükleniyor…" yerine bir "Yeniden yükle" ekranı gösterir.
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { /* sessiz — kullanıcıya buton gösteriyoruz */ }
  render() {
    if (this.state.failed) {
      return (
        <div className="grid min-h-screen place-items-center bg-canvas px-6 text-center">
          <div>
            <p className="mb-1 text-lg font-semibold text-brand-800">Uygulama güncellendi</p>
            <p className="mb-4 text-sm text-brand-400">Yeni sürümü yüklemek için sayfayı yenileyin.</p>
            <button onClick={() => { sessionStorage.removeItem('depo:chunk-reloaded'); window.location.reload() }} className="btn-primary">
              Yeniden yükle
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  const { auth, loading, authExpired } = useAuth()

  if (loading) return <Splash />
  if (!auth || authExpired) return <Login />

  return (
    <ErrorBoundary>
      <BrowserRouter basename={BASENAME}>
        <Suspense fallback={<Splash />}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Navigate to="scan" replace />} />
              <Route path="scan" element={<Scan />} />
              <Route path="search" element={<Search />} />
              <Route path="intake" element={<Intake />} />
              <Route path="labels" element={<Labels />} />
              <Route path="settings" element={<Settings />} />
              <Route path="l/:code" element={<LocationView />} />
              <Route path="parts/:id" element={<PartDetail />} />
              <Route path="shopping" element={<Shopping />} />
              <Route path="*" element={<Navigate to="scan" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
