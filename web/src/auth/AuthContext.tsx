// Kimlik durumu. Offline-first: önbellekteki tenant/rol IndexedDB'de tutulur (ARCHITECTURE §3).

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { AuthState } from '../db/types'
import { getAuth, setAuth as persistAuth, wipeLocalData } from '../db/dexie'
import { api } from '../sync/api'
import { engine } from '../sync/engine'

interface AuthCtx {
  auth: AuthState | null
  loading: boolean
  authExpired: boolean
  login: (identifier: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuthState] = useState<AuthState | null>(null)
  const [loading, setLoading] = useState(true)
  const [authExpired, setAuthExpired] = useState(false)

  // İlk yükleme: önbellekten kimliği al (offline çalışabilsin).
  useEffect(() => {
    let active = true
    void (async () => {
      const cached = await getAuth()
      if (!active) return
      setAuthState(cached)
      setLoading(false)
      if (cached) engine.start()
    })()
    return () => {
      active = false
    }
  }, [])

  // Motor "oturum doldu" derse işaretle.
  useEffect(() => {
    return engine.subscribe((s) => {
      if (s.authExpired) setAuthExpired(true)
    })
  }, [])

  const login = useCallback(async (identifier: string, password: string) => {
    const result = await api.login(identifier, password)
    await persistAuth(result)
    setAuthState(result)
    setAuthExpired(false)
    engine.start()
    void engine.sync()
  }, [])

  const refresh = useCallback(async () => {
    try {
      const result = await api.me()
      await persistAuth(result)
      setAuthState(result)
    } catch {
      /* çevrimdışı olabilir — önbellek kalır */
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      /* offline olabilir — yerel çıkışı yine de yap */
    }
    engine.stop()
    await wipeLocalData()
    setAuthState(null)
    setAuthExpired(false)
  }, [])

  return (
    <Ctx.Provider value={{ auth, loading, authExpired, login, logout, refresh }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
