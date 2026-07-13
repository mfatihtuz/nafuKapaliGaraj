import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppHeader, Container } from '../components/Layout'
import { startScanner, extractLocationCode, type ScannerHandle } from '../lib/scanner'
import { useT } from '../i18n'
import { IconCamera, IconChevronRight } from '../components/icons'

export function Scan() {
  const { t } = useT()
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const handleRef = useRef<ScannerHandle | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  const doneRef = useRef(false)

  useEffect(() => {
    return () => handleRef.current?.stop()
  }, [])

  async function start() {
    setError(null)
    doneRef.current = false
    const video = videoRef.current
    if (!video) return
    try {
      setScanning(true)
      handleRef.current = await startScanner(video, (text) => {
        if (doneRef.current) return
        doneRef.current = true
        handleRef.current?.stop()
        setScanning(false)
        navigate(`/l/${encodeURIComponent(extractLocationCode(text))}`)
      })
    } catch {
      setScanning(false)
      setError(t('scan.permission_denied'))
    }
  }

  function goManual() {
    const code = manual.trim().toUpperCase()
    if (code) navigate(`/l/${encodeURIComponent(code)}`)
  }

  return (
    <>
      <AppHeader />
      <Container>
        <div className="flex flex-col gap-4">
          <div className="card overflow-hidden">
            <div className="relative aspect-square bg-brand-900">
              <video
                ref={videoRef}
                className="h-full w-full object-cover"
                muted
                playsInline
              />
              {!scanning && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white/80">
                  <IconCamera size={48} />
                  <p className="px-8 text-center text-sm">{t('scan.hint')}</p>
                  <button onClick={() => void start()} className="btn-primary">
                    {t('scan.start_camera')}
                  </button>
                </div>
              )}
              {scanning && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <div className="h-56 w-56 rounded-2xl border-4 border-accent/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                </div>
              )}
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">{error}</p>
          )}

          <div className="card p-4">
            <label className="field-label" htmlFor="manual">{t('scan.manual')}</label>
            <div className="flex gap-2">
              <input
                id="manual"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && goManual()}
                placeholder={t('scan.manual_placeholder')}
                className="input font-mono uppercase"
                autoCapitalize="characters"
              />
              <button onClick={goManual} className="btn-navy px-5">
                {t('scan.go')}
                <IconChevronRight size={18} />
              </button>
            </div>
          </div>
        </div>
      </Container>
    </>
  )
}
