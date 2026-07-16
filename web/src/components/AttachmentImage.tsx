import { useEffect, useState } from 'react'
import { IconImageOff } from './icons'

const API_BASE = import.meta.env.BASE_URL.replace(/\/+$/, '') + '/api'

/**
 * Bir eki gösterir. İki kaynak:
 *  • blob verilirse (henüz yüklenmemiş): in-memory object URL (offline/optimistik).
 *  • attId verilirse (yüklenmiş): sunucu byte ucu /api/files/:id (?thumb=1). Cookie
 *    same-origin otomatik gider; yanıt immutable cache'li → ilk görüntülemeden sonra
 *    çevrimdışı da açılır. <img> tarayıcı cache'i kullanır (api.ts no-store'u etkilemez).
 */
export function AttachmentImage({
  attId, blob, thumb = true, className, alt = '',
}: {
  attId?: string
  blob?: Blob
  thumb?: boolean
  className?: string
  alt?: string
}) {
  const [objUrl, setObjUrl] = useState<string>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false) // kaynak değişince hata durumunu sıfırla
    if (!blob) {
      setObjUrl(undefined)
      return
    }
    const u = URL.createObjectURL(blob)
    setObjUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob, attId])

  const src = blob ? objUrl : attId ? `${API_BASE}/files/${attId}${thumb ? '?thumb=1' : ''}` : undefined
  if (!src) return null
  // Resim çekilemezse (çevrimdışı ilk görüntüleme / sunucuda silinmiş / 404) kırık-resim
  // ikonu yerine nazik bir yer tutucu göster (bulgu #8).
  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-brand-100 text-brand-300 ${className ?? ''}`} role="img" aria-label={alt}>
        <IconImageOff size={22} />
      </div>
    )
  }
  return <img src={src} alt={alt} className={className} loading="lazy" onError={() => setFailed(true)} />
}
