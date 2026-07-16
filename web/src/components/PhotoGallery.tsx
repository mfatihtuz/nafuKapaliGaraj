import { useRef, useState } from 'react'
import type { AttachmentOwnerType } from '../db/types'
import { useOwnerAttachments } from '../db/queries'
import { addAttachment, deleteAttachment, cancelPendingUpload } from '../db/actions'
import { AttachmentImage } from './AttachmentImage'
import { useT } from '../i18n'
import { useToast } from './Toast'
import { IconImage, IconCamera, IconTrash, IconX } from './icons'

/**
 * Foto/PDF galeri kartı — Parça detayı ve (tekil kullanımda) konum için.
 * Ekle (kamera/galeri), küçük önizleme ızgarası, dokun→tam ekran, sil. Offline-first:
 * yeni foto anında görünür (bekleyen), online olunca yüklenir.
 */
export function PhotoGallery({
  ownerType, ownerId, canWrite, title,
}: {
  ownerType: AttachmentOwnerType
  ownerId: string
  canWrite: boolean
  title?: string
}) {
  const { t } = useT()
  const toast = useToast()
  const { synced, pending } = useOwnerAttachments(ownerType, ownerId)
  const [lightbox, setLightbox] = useState<string | undefined>()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function pick(files: File[]) {
    setBusy(true)
    try {
      for (const f of files) {
        await addAttachment(ownerType, ownerId, f)
      }
    } catch {
      toast.show(t('photos.add_error'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const isEmpty = synced.length === 0 && pending.length === 0

  return (
    <div className="card card-pad">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-brand-800">
          <IconImage size={18} /> {title ?? t('photos.title')}
        </h2>
        {canWrite && (
          <>
            <input
              ref={inputRef} type="file" accept="image/*,application/pdf" multiple className="hidden"
              onChange={(e) => {
                const fs = Array.from(e.target.files ?? [])
                e.target.value = ''
                if (fs.length) void pick(fs)
              }}
            />
            <button onClick={() => inputRef.current?.click()} disabled={busy} className="btn-ghost h-9 text-sm">
              <IconCamera size={16} /> {busy ? t('photos.adding') : t('photos.add')}
            </button>
          </>
        )}
      </div>

      {isEmpty ? (
        <p className="py-4 text-center text-sm text-brand-300">{t('photos.empty')}</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {synced.map((a) => (
            <div key={a.id} className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-brand-50">
              {a.kind === 'photo' ? (
                <button onClick={() => setLightbox(a.id)} className="h-full w-full" aria-label={t('photos.view')}>
                  <AttachmentImage attId={a.id} thumb className="h-full w-full object-cover" alt={a.filename} />
                </button>
              ) : (
                <a href={`${import.meta.env.BASE_URL.replace(/\/+$/, '')}/api/files/${a.id}`} target="_blank" rel="noreferrer"
                  className="flex h-full w-full flex-col items-center justify-center gap-1 text-brand-400">
                  <IconImage size={22} /><span className="px-1 text-[10px]">PDF</span>
                </a>
              )}
              {canWrite && (
                <button onClick={() => void deleteAttachment(a.id)}
                  className="absolute right-1 top-1 rounded-full bg-black/50 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label={t('common.delete')}>
                  <IconTrash size={13} />
                </button>
              )}
            </div>
          ))}
          {pending.map((u) => (
            <div key={u.id} className="relative aspect-square overflow-hidden rounded-lg border border-dashed border-accent bg-brand-50">
              {u.kind === 'photo' ? (
                <AttachmentImage blob={u.blob} className="h-full w-full object-cover opacity-70" alt={u.filename} />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-brand-300"><IconImage size={22} /></div>
              )}
              <span className="absolute inset-x-0 bottom-0 bg-accent/90 py-0.5 text-center text-[10px] font-medium text-brand-900">
                {t('photos.pending')}
              </span>
              {canWrite && (
                <button onClick={() => void cancelPendingUpload(u.id)}
                  className="absolute right-1 top-1 rounded-full bg-black/50 p-1 text-white" aria-label={t('common.cancel')}>
                  <IconX size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={() => setLightbox(undefined)} role="dialog" aria-modal="true">
          <button className="absolute right-4 top-4 rounded-full bg-white/15 p-2 text-white" aria-label={t('common.close')}>
            <IconX size={22} />
          </button>
          <AttachmentImage attId={lightbox} thumb={false} className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  )
}
