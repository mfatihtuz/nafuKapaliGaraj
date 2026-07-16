// Giden ek yükleme kuyruğu (FAZ 2.1). Normal JSON outbox'tan AYRIDIR: ikili dosya
// JSON push'a giremez → çok-parçalı POST /api/files. Başarıda: sunucu metadata'sını
// attachments tablosuna yaz, uploads'tan sil (blob serbest kalır). Hata: attempts++.

import { db } from '../db/dexie'
import type { PendingUpload } from '../db/types'
import { api, ApiError } from './api'
import { mapAttachment } from './apply'
import { enqueue } from './outbox'
import { nowIso } from '../lib/format'

export const MAX_ATTEMPTS = 8

/** Bekleyen yüklemeleri sırayla sunucuya iletir. Online iken engine'den çağrılır. */
export async function flushUploads(): Promise<{ uploaded: number }> {
  const pending = await db.uploads.orderBy('created_at').toArray()
  let uploaded = 0
  for (const up of pending) {
    if (up.attempts >= MAX_ATTEMPTS) continue // kalıcı hata — kullanıcı elle silebilir
    try {
      // up.id sunucuya idempotency anahtarı olarak gider (sunucu attachment PK'sı yapar) →
      // timeout sonrası yeniden yükleme çift satır üretmez (bulgu #4).
      const meta = await api.uploadAttachment(up.id, up.owner_type, up.owner_id, up.blob, up.filename)
      // Sunucu kanonik metadata döndü → attachments'a yaz, kuyruk kaydını sil. ANCAK ağ
      // beklerken kullanıcı iptal etmiş olabilir (cancelPendingUpload → uploads.delete).
      // O hâlde eki YAZMA (kullanıcının iptalini sessizce geri alma — bulgu #7); bunun
      // yerine sunucudaki satırı geri al (soft-delete outbox'a). up.id === attachment id.
      const stillPending = await db.uploads.get(up.id)
      if (!stillPending) {
        await enqueue({ type: 'delete', entity: 'attachment', data: { id: up.id, updated_at: nowIso() } })
        continue
      }
      await db.transaction('rw', db.attachments, db.uploads, async () => {
        // Transaction içinde SON kez doğrula (yarış penceresini daralt).
        if (!(await db.uploads.get(up.id))) return
        await db.attachments.put(mapAttachment(meta))
        await db.uploads.delete(up.id)
      })
      uploaded++
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'yükleme hatası'
      // Ağ/timeout (status 0) → geçici, attempts artırma cezası hafif; sunucu reddi → say.
      const transient = e instanceof ApiError && e.status === 0
      await db.uploads.update(up.id, {
        attempts: transient ? up.attempts : up.attempts + 1,
        last_error: msg,
        last_attempt_at: Date.now(),
      } as Partial<PendingUpload>)
      if (transient) break // çevrimdışı — kalanları deneme, sonra
    }
  }
  return { uploaded }
}

export async function pendingUploadCount(): Promise<number> {
  return db.uploads.count()
}
