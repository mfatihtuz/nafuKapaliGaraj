# SYNC_PROTOCOL — Offline-First Senkronizasyon

> **Bu projenin en kritik dokümanı.** Buradaki kuralları ihlal eden her uygulama, er ya da geç stok verisini bozar. Bozulan stok verisi = güvenilmeyen sistem = ölü sistem.

---

## 1. Temel İlke

> **Miktarı senkronize etme. Hareketi senkronize et.**

Klasik senkronizasyon "son yazan kazanır" (Last-Write-Wins) mantığı kullanır. Stokta bu **felakettir**:

```
Başlangıç: 10K direnç = 100 adet

Telefon (garajda, offline):   -3 kullandım  →  yerel: 97
Bilgisayar (evde, online):    -5 kullandım  →  sunucu: 95

Telefon internete kavuşur, "qty = 97" gönderir.
LWW → sunucu: 97.   ❌ DOĞRUSU 92 OLMALIYDI.
```

Doğrusu:

```
Telefon push eder:      {op: "stock_move", delta: -3, op_id: "a1..."}
Bilgisayar push etmiş:  {op: "stock_move", delta: -5, op_id: "b2..."}

Sunucu her ikisini de deftere ekler:
  100 - 5 - 3 = 92   ✅
```

**Delta'lar toplanabilir (commutative). Mutlak değerler toplanamaz.**
Bu yüzden `stock.qty` **asla** istemciden gönderilmez. `stock.qty` sunucuda **türetilmiş** bir alandır.

---

## 2. Varlık Sınıfları

Her varlık, senkronizasyon açısından iki sınıftan birine girer:

### A) Katalog varlıkları — LWW (Last-Write-Wins) uygun
`parts`, `locations`, `categories`, `projects`, `suppliers`, `settings`

- Bunlar **durum** (state) taşır, sayı değil.
- Çakışma: `updated_at` büyük olan kazanır. Eşitlikte `id` büyük olan kazanır (deterministik).
- Kayıp riski: Aynı parçanın açıklamasını iki cihazdan aynı anda düzenlersen biri kaybolur. **Kabul edilebilir** — nadir ve zararsız.
- Silme: **soft delete** (`deleted_at`). Hard delete asla senkronize edilemez.

### B) Defter varlıkları — Append-only, çakışma YOK
`stock_transactions`

- Bunlar **olay** (event) taşır.
- Çakışma diye bir şey yok — hepsi deftere eklenir.
- `op_id` (istemci üretimli UUID) ile **idempotent**: aynı işlem iki kez gönderilse bile bir kez uygulanır.

`stock` tablosu **hiçbir zaman senkronize edilmez.** O, defterin bir görünümüdür (materialized view). İstemci de yerelde kendi `stock` görünümünü defterden türetir.

---

## 3. Kimlikler

**Tüm ID'ler istemci tarafında üretilir: UUIDv7.**

Neden UUIDv7 (auto-increment değil):
- Offline'da yeni parça oluşturabilmelisin — sunucudan ID beklemeden.
- UUIDv7 zaman-sıralıdır → B-tree index parçalanması UUIDv4'e göre çok daha az. MySQL'de kritik.

```ts
// web/src/lib/uuid.ts
export function uuidv7(): string {
  const ts = Date.now();                     // 48 bit
  const rand = crypto.getRandomValues(new Uint8Array(10));
  // ... RFC 9562 UUIDv7 formatı
}
```

PHP tarafında da doğrulama için bir `Uuid::isV7()` olsun; istemci geçersiz ID gönderirse reddet.

---

## 4. Değişiklik Defteri (change_log)

Sunucuda, tenant başına monoton artan bir sıra numarası:

```sql
CREATE TABLE change_log (
  seq        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id  CHAR(36) NOT NULL,
  entity     VARCHAR(32) NOT NULL,     -- 'part','location','stock_transaction',...
  entity_id  CHAR(36) NOT NULL,
  op         ENUM('upsert','delete') NOT NULL,
  payload    JSON NOT NULL,            -- varlığın tam hali
  actor_id   CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_tenant_seq (tenant_id, seq)
);
```

> `seq` global AUTO_INCREMENT ama sorgular `WHERE tenant_id = ? AND seq > ?` ile filtrelenir.
> Boşluklar (gap) olması sorun değil — istemci sadece "son gördüğüm seq"i takip eder.

---

## 5. Protokol

### 5.1 Bootstrap (ilk kurulum)
```
GET /api/sync/bootstrap
→ {
    tenant: {...},
    categories: [...], locations: [...], parts: [...],
    stock_transactions: [...],        // son 90 gün + açılış bakiyeleri
    stock_snapshot: [...],            // {part_id, location_id, qty, level}
    cursor: 128473                    // bu andaki max seq
  }
```
İstemci `stock_snapshot`'ı temel alır, sonraki hareketleri üstüne uygular.
(Tüm defteri indirmek gereksiz — 5 yıl sonra 100 bin hareket olur.)

### 5.2 Pull
```
GET /api/sync/pull?since=128473&limit=500
→ { changes: [{seq, entity, entity_id, op, payload}, ...], cursor: 128691, has_more: false }
```
- İstemci `changes`'ı sırayla uygular, `cursor`'ı kaydeder.
- `has_more: true` ise hemen tekrar çağır.
- **Push'tan ÖNCE pull yap.** Sıra: `pull → push → pull`.

### 5.3 Push
```
POST /api/sync/push
{
  ops: [
    { op_id: "018f...", type: "upsert", entity: "part",
      data: { id: "018e...", sku: "R-0805-10K-1P", ... , updated_at: "2026-07-13T09:14:22.412Z" } },

    { op_id: "018f...", type: "stock_move", data: {
        id: "018f...",              // transaction id
        part_id: "018e...",
        location_id: "018d...",
        delta: -3,                  // exact modda
        level_to: null,             // level modda: 'full'|'low'|'empty'
        reason: "consume",
        project_id: null,
        note: null,
        created_at: "2026-07-13T09:14:22.412Z"   // istemci saati (sadece bilgi)
    }},

    { op_id: "018f...", type: "stock_audit", data: {
        part_id: "...", location_id: "...", counted_qty: 87, note: "aylık sayım"
    }}
  ]
}
→ { applied: ["018f...", "018f..."], rejected: [{op_id, reason}], cursor: 128700 }
```

**Sunucu davranışı:**
```
BEGIN TRANSACTION
FOR EACH op:
    IF EXISTS(sync_ops WHERE op_id = op.op_id):  → zaten uygulanmış, atla (idempotent)
    INSERT INTO sync_ops (op_id, tenant_id, applied_at)

    SWITCH op.type:
      upsert  → LWW: sadece gelen updated_at > mevcut updated_at ise yaz
                change_log'a yaz
      delete  → soft delete, change_log'a yaz
      stock_move  → stock_transactions'a EKLE (asla LWW yok)
                    stock.qty += delta   (veya stock.level = level_to)
                    change_log'a yaz
      stock_audit → mevcut qty'yi oku, delta = counted_qty - current_qty
                    reason='audit' ile stock_move olarak işle
COMMIT
```

### 5.4 Outbox (istemci)
```ts
// Kullanıcı [-1]'e bastığında:
// 1. YEREL: stok görünümünü ANINDA güncelle (optimistik)
// 2. Outbox'a bir op yaz
// 3. Arka planda push dene. Başarısızsa outbox'ta kalır, sonra tekrar denenir.

interface OutboxOp {
  op_id: string;        // UUIDv7 — idempotency anahtarı
  type: 'upsert' | 'delete' | 'stock_move' | 'stock_audit';
  entity?: string;
  data: unknown;
  created_at: number;
  attempts: number;
  last_error?: string;
}
```
- Push başarılı olan op'lar outbox'tan silinir.
- `rejected` olanlar kullanıcıya gösterilir (nadiren olmalı).
- 5 başarısız denemeden sonra exponential backoff + kullanıcıya "senkronizasyon sorunu" rozeti.
- **Outbox asla sessizce boşaltılmaz.**

### 5.5 Tetikleyiciler
Sync ne zaman çalışır:
- Uygulama açılışında
- `online` event'inde (`window.addEventListener('online', ...)`)
- Outbox'a yeni op yazıldığında (online ise, 500 ms debounce)
- Ön plana geldiğinde (`visibilitychange`)
- Her 5 dakikada bir (online ve ön plandaysa)

---

## 6. Level (DOLU/AZ/BİTTİ) Modunda Çakışma

Level bir **durum**, delta değil. Bu yüzden LWW uygulanır:

```
stock_move { level_to: 'low', created_at: T1 }
stock_move { level_to: 'empty', created_at: T2 }
→ T2 > T1 ise sonuç: 'empty'
```
- Yine de her ikisi de deftere yazılır (denetim izi korunur).
- `stock.level` alanına en yeni `created_at`'e sahip olan yazılır.
- Bu kabul edilebilir: iki cihazdan aynı çekmecenin seviyesini aynı anda değiştirmek pratikte olmaz.

---

## 7. Sunucu Saati vs İstemci Saati

- İstemci saati güvenilmezdir (kullanıcı değiştirebilir, timezone karışabilir).
- **Sıralama için daima `change_log.seq` kullanılır** (sunucu üretimli, monoton).
- `created_at` sadece görüntüleme ve LWW karşılaştırması için.
- LWW'de: `updated_at` istemciden gelir ama sunucu **kendi saatiyle sınırlar**:
  `updated_at = min(client_updated_at, now() + 5 minutes)` → gelecekten gelen kayıtları engelle.

---

## 8. Test Senaryoları (ZORUNLU)

Bu testler geçmeden Faz 1 tamamlanmış sayılmaz:

| # | Senaryo | Beklenen |
|---|---|---|
| 1 | Uçak modunda 20 işlem yap, online ol | Hepsi sırayla uygulanır, hiçbiri kaybolmaz |
| 2 | Aynı push payload'ını 3 kez gönder | Stok bir kez değişir (idempotency) |
| 3 | Cihaz A offline `-3`, cihaz B online `-5`, sonra A senkronize olur | Sonuç `-8` |
| 4 | Aynı parçayı iki cihazdan farklı isimle düzenle | Son yazan kazanır, çökme yok |
| 5 | Push sırasında ağ kopar (yanıt gelmez) | İstemci tekrar dener, çift kayıt OLUŞMAZ |
| 6 | Cihaz A'da parça sil, cihaz B'de aynı parçaya stok hareketi | Hareket kaydedilir, parça silinmiş görünür (soft delete). Veri kaybı yok. |
| 7 | Tenant A'nın token'ıyla tenant B'nin verisini çek | 404 |
| 8 | Bootstrap → 500 değişiklik pull → yerel stok, sunucu stoğuyla birebir aynı | ✅ |

Test 3 ve 5, projenin **tek kritik testidir**. Diğer her şey yeniden yazılabilir; bozulan stok verisi geri gelmez.

---

## 9. Tutarlılık Kontrolü (self-healing)

Ayda bir (veya kullanıcı isteğiyle):
```
GET /api/sync/checksum
→ { part_count: 412, tx_count: 8891, stock_hash: "sha256:..." }
```
İstemci kendi hesabını yapar. Uyuşmazsa → tam bootstrap'i tekrar çalıştırır.
Bu, "bir yerlerde bir şey kaydı" tipi sinsi hataların ilacıdır. **Basit ve çok değerli.**
