import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { I18nProvider } from './i18n'
import { ToastProvider } from './components/Toast'
import { AuthProvider } from './auth/AuthContext'
import './index.css'

// Service worker — uygulama kabuğu offline (autoUpdate).
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </I18nProvider>
  </StrictMode>,
)
