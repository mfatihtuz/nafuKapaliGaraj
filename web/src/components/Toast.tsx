import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type ToastKind = 'success' | 'error' | 'info'
interface Toast { id: number; message: string; kind: ToastKind }

interface ToastCtx {
  show: (message: string, kind?: ToastKind) => void
}
const Ctx = createContext<ToastCtx | null>(null)

let counter = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = ++counter
    setToasts((t) => [...t, { id, message, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600)
  }, [])

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div className="no-print pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto max-w-sm rounded-xl px-4 py-3 text-sm font-medium shadow-pop ${
              t.kind === 'success'
                ? 'bg-green-600 text-white'
                : t.kind === 'error'
                  ? 'bg-red-600 text-white'
                  : 'bg-brand text-white'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
