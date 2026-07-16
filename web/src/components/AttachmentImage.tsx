import { useEffect, useState } from 'react'

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
  useEffect(() => {
    if (!blob) {
      setObjUrl(undefined)
      return
    }
    const u = URL.createObjectURL(blob)
    setObjUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])

  const src = blob ? objUrl : attId ? `${API_BASE}/files/${attId}${thumb ? '?thumb=1' : ''}` : undefined
  if (!src) return null
  return <img src={src} alt={alt} className={className} loading="lazy" />
}
