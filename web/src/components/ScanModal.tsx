import { useEffect, useRef, useState } from 'react'
import { startScanner, type ScannerHandle } from '../lib/scanner'
import { useT } from '../i18n'
import { IconCamera, IconX } from './icons'

/**
 * Yeniden kullanılabilir kamera tarama modalı. Barkod (multiFormat) veya QR okur;
 * bir kod yakalayınca onResult(code) çağırır ve kapanır. Kamera reddedilirse elle
 * giriş kutusu gösterir. Kamera kaynağı sökülürken MUTLAKA durdurulur (sızıntı yok).
 */
export function ScanModal({
  onResult, onClose, title, multiFormat = true, manualPlaceholder,
}: {
  onResult: (code: string) => void
  onClose: () => void
  title?: string
  multiFormat?: boolean
  manualPlaceholder?: string
}) {
  const { t } = useT()
  const videoRef = useRef<HTMLVideoElement>(null)
  const handleRef = useRef<ScannerHandle | null>(null)
  const doneRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState('')

  function finish(code: string) {
    if (doneRef.current) return
    doneRef.current = true
    handleRef.current?.stop()
    onResult(code)
  }

  useEffect(() => {
    // Her effect çalışması KENDİ yerel bayrağını + handle'ını tutar (StrictMode çift-mount
    // güvenli): ilk çalışmanın cleanup'ı kendi kamera akışını kapatır → sızıntı olmaz.
    let cancelled = false
    let localHandle: ScannerHandle | null = null
    ;(async () => {
      const video = videoRef.current
      if (!video) return
      try {
        const handle = await startScanner(video, (text) => finish(text.trim()), { multiFormat })
        if (cancelled) { handle.stop(); return } // await sırasında sökülmüş → hemen kapat
        localHandle = handle
        handleRef.current = handle
      } catch {
        if (!cancelled) setError(t('scan.permission_denied'))
      }
    })()
    return () => {
      cancelled = true
      localHandle?.stop()
      handleRef.current?.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiFormat])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="font-medium">{title ?? t('scan.barcode_title')}</span>
        <button onClick={onClose} className="rounded-full bg-white/15 p-2" aria-label={t('common.close')}>
          <IconX size={20} />
        </button>
      </div>

      <div className="relative mx-auto aspect-square w-full max-w-md overflow-hidden bg-brand-900">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        {!error && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="h-40 w-64 rounded-2xl border-4 border-accent/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-white/80">
            <div><IconCamera size={40} className="mx-auto mb-2" /><p className="text-sm">{error}</p></div>
          </div>
        )}
      </div>

      <div className="mx-auto mt-4 w-full max-w-md px-4">
        <label className="mb-1 block text-xs text-white/60">{t('scan.manual')}</label>
        <div className="flex gap-2">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && manual.trim()) finish(manual.trim()) }}
            placeholder={manualPlaceholder ?? t('scan.barcode_manual')}
            className="input flex-1 font-mono"
            autoFocus={!!error}
          />
          <button onClick={() => manual.trim() && finish(manual.trim())} className="btn-primary px-5">{t('scan.go')}</button>
        </div>
      </div>
    </div>
  )
}
