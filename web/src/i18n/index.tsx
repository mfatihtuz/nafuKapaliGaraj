// Hafif i18n. Kodda sabit metin yok (CLAUDE.md §5); t('nav.scan') ile çözülür.
// Varsayılan tr; en.json Faz 1'de kısmi (SPRINT_PLAN).

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import tr from './tr.json'
import en from './en.json'

type Dict = Record<string, unknown>
const DICTS: Record<string, Dict> = { tr, en }
const DEFAULT_LANG = 'tr'
export const LANGS = ['tr', 'en'] as const

function resolve(dict: Dict, key: string): string | undefined {
  let cur: unknown = dict
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as object)) {
      cur = (cur as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }
  return typeof cur === 'string' ? cur : undefined
}

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`))
}

export type TFn = (key: string, vars?: Record<string, string | number>) => string

interface I18nCtx {
  lang: string
  setLang: (l: string) => void
  t: TFn
}

const Ctx = createContext<I18nCtx | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<string>(
    () => localStorage.getItem('depo_lang') ?? DEFAULT_LANG,
  )
  const setLang = useCallback((l: string) => {
    localStorage.setItem('depo_lang', l)
    setLangState(l)
  }, [])
  const t = useCallback<TFn>(
    (key, vars) => {
      const s = resolve(DICTS[lang] ?? {}, key) ?? resolve(DICTS[DEFAULT_LANG], key) ?? key
      return interpolate(s, vars)
    },
    [lang],
  )
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>
}

export function useT(): I18nCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useT must be used within I18nProvider')
  return ctx
}
