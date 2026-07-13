import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import { Layout } from './components/Layout'
import { Login } from './pages/Login'
import { useT } from './i18n'

// Rota-bazlı kod bölme — açılışta yalnızca kabuk yüklenir (ARCHITECTURE §7).
const Scan = lazy(() => import('./pages/Scan').then((m) => ({ default: m.Scan })))
const Search = lazy(() => import('./pages/Search').then((m) => ({ default: m.Search })))
const Intake = lazy(() => import('./pages/Intake').then((m) => ({ default: m.Intake })))
const Labels = lazy(() => import('./pages/Labels').then((m) => ({ default: m.Labels })))
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })))
const LocationView = lazy(() => import('./pages/LocationView').then((m) => ({ default: m.LocationView })))
const PartDetail = lazy(() => import('./pages/PartDetail').then((m) => ({ default: m.PartDetail })))

const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, '')

function Splash() {
  const { t } = useT()
  return (
    <div className="grid min-h-screen place-items-center bg-brand text-white/70">
      {t('common.loading')}
    </div>
  )
}

export default function App() {
  const { auth, loading, authExpired } = useAuth()

  if (loading) return <Splash />
  if (!auth || authExpired) return <Login />

  return (
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
            <Route path="*" element={<Navigate to="scan" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
