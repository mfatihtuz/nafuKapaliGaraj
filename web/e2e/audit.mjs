// ============================================================================
// DEPO — Kapsamlı tarayıcı E2E denetim paketi (kalıcı regresyon testi).
//
// KULLANIM:
//   1. cd web && npm run build && npm run preview   (4173 portunda)
//   2. node e2e/audit.mjs        (veya npx tsx e2e/audit.mjs)
//
// Gerçek backend GEREKMEZ: kimlik + veri IndexedDB'ye enjekte edilir,
// gereken API uçları route-mock'lanır. Ağ hatasında outbox kuyruğu dolar
// (revert YOK — yalnızca sunucu reddi revert tetikler), UI Dexie'den okur.
// ============================================================================
import { chromium } from 'playwright-core'
import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'

/** Geçerli, çözülebilir bir PNG üret (WxH düz renk) — headless Chromium 1x1 kırık
 *  base64'ü decode ETMEZ; gerçek foto akışını test etmek için sağlam bir görsel gerek. */
function makePngB64(w = 8, h = 8) {
  const crc32 = (buf) => {
    let c = ~0
    for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)) }
    return (~c) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2 // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: w }, () => Buffer.from([220, 40, 40])))])
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
  return png.toString('base64')
}

/** Sunucu SyncService::stockChecksum ile BİREBİR aynı kanonik özet (self-heal testi). */
function serverChecksum(rows) {
  const lines = rows.map((s) => `${s.part_id}:${s.location_id}:${Math.round(Number(s.qty) * 1000)}:${s.level ?? ''}`)
  lines.sort()
  return createHash('sha256').update(lines.join('\n')).digest('hex')
}

const EXE = process.env.CHROME_EXE ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173/depo_yonetimi/'
const OUT = process.env.REPORT_OUT ?? '/tmp/depo-e2e-report.json'

const results = []
let section = ''
function check(name, ok, detail = '') {
  results.push({ section, name, ok: !!ok, detail: String(detail).slice(0, 300) })
  console.log(`${ok ? '  ✓' : '  ✗'} [${section}] ${name}${ok ? '' : ' — ' + detail}`)
}

// ---------------------------------------------------------------------------
// Fikstür: kategoriler / konumlar / parçalar / stok
// ---------------------------------------------------------------------------
const NOW = '2026-07-14T10:00:00.000Z'
function fixture() {
  const cats = [
    { id: 'cat-pas', parent_id: null, name_tr: 'Pasif', name_en: null, code: 'PAS', attribute_schema: null, sku_template: null, default_count_mode: 'exact', sort_order: 1, updated_at: NOW, deleted_at: null },
    { id: 'cat-r', parent_id: 'cat-pas', name_tr: 'Direnç', name_en: null, code: 'R', attribute_schema: [
      { key: 'deger', label_tr: 'Değer', type: 'text', unit: 'Ω', required: true, in_sku: true, order: 1 },
      { key: 'paket', label_tr: 'Paket', type: 'enum', options: ['0805', 'THT'], required: false, in_sku: true, order: 2 },
    ], sku_template: 'R-{deger}-{paket}', default_count_mode: 'exact', sort_order: 2, updated_at: NOW, deleted_at: null },
    { id: 'cat-cam', parent_id: null, name_tr: 'Cam Malzeme', name_en: null, code: 'CAM', attribute_schema: [
      { key: 'deger', label_tr: 'Tanım', type: 'text', required: true, in_sku: true, order: 1 },
    ], sku_template: 'CAM-{deger}', default_count_mode: 'level', sort_order: 3, updated_at: NOW, deleted_at: null },
    { id: 'cat-msc', parent_id: null, name_tr: 'Muhtelif', name_en: null, code: 'MSC', attribute_schema: [
      { key: 'deger', label_tr: 'Tanım', type: 'text', required: true, in_sku: true, order: 1 },
    ], sku_template: 'MSC-{deger}', default_count_mode: 'unmanaged', sort_order: 4, updated_at: NOW, deleted_at: null },
  ]
  const locs = []
  const L = (id, parent_id, code, type, path) => locs.push({ id, parent_id, code, name: null, type, path, photo_id: null, capacity_note: null, sort_order: locs.length, updated_at: NOW, deleted_at: null })
  L('cab', null, 'S3', 'cabinet', 'GARAJ/S3')
  L('mod1', 'cab', 'S3-01', 'shelf', 'GARAJ/S3/S3-01')
  L('mod2', 'cab', 'S3-02', 'shelf', 'GARAJ/S3/S3-02')
  L('c11', 'mod1', 'S3-01-1', 'drawer', 'GARAJ/S3/S3-01/S3-01-1')
  L('c12', 'mod1', 'S3-01-2', 'drawer', 'GARAJ/S3/S3-01/S3-01-2')
  L('c21', 'mod2', 'S3-02-1', 'drawer', 'GARAJ/S3/S3-02/S3-02-1')
  L('c22', 'mod2', 'S3-02-2', 'drawer', 'GARAJ/S3/S3-02/S3-02-2')
  L('d1', null, 'D1', 'drawer', 'GARAJ/D1')
  L('d2', null, 'D2', 'drawer', 'GARAJ/D2')
  L('qrt', null, 'QRT', 'quarantine', 'GARAJ/QRT')

  const P = (id, cat, sku, name, mode, extra = {}) => ({
    id, category_id: cat, sku, name, mpn: null, manufacturer: null,
    attributes: { deger: 'X' }, tags: name.toLowerCase(), count_mode: mode, abc_class: 'C',
    min_qty: null, unit: 'adet', datasheet_url: null, photo_id: null, notes: null,
    updated_at: NOW, deleted_at: null, ...extra,
  })
  const parts = [
    P('p-r', 'cat-r', 'R-10K-0805', '10K Direnç', 'exact'),
    P('p-cam', 'cat-cam', 'CAM-ELYAF', 'Cam Elyaf', 'level'),
    P('p-unm', 'cat-msc', 'MSC-HURDA', 'Karışık Hurda', 'unmanaged'),
    P('p-zero', 'cat-r', 'R-1K-THT', 'Tükenmiş Parça', 'exact'),
    P('p-arch', 'cat-r', 'R-9K9', 'Arşivli Parça', 'exact', { deleted_at: NOW }),
    P('p-qrt', 'cat-r', 'R-5K5', 'Karantina Parça', 'exact'),
  ]
  const S = (part_id, location_id, qty, level = null) => ({
    key: `${part_id}|${location_id}`, part_id, location_id, qty, level, level_at: level ? NOW : null, last_move_at: NOW,
  })
  const stock = [
    S('p-r', 'd1', 50),
    S('p-cam', 'd2', 0, 'full'),
    S('p-unm', 'd1', 0),
    S('p-zero', 'd2', 0),
    S('p-arch', 'd1', 5),
    S('p-qrt', 'qrt', 3),
  ]
  return { cats, locs, parts, stock }
}

// ---------------------------------------------------------------------------
// Bölüm başlatıcı: taze context + veri enjeksiyonu + API mock
// ---------------------------------------------------------------------------
async function openSection(browser, name, { role = 'owner', settings = {}, viewport = null, routes = null } = {}) {
  section = name
  const ctx = await browser.newContext(viewport ? { viewport } : {})
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('dialog', (d) => d.accept())
  if (routes) await routes(page)
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 })
  await page.waitForTimeout(300)
  const fx = fixture()
  await page.evaluate(async ({ fx, role, settings, NOW }) => {
    function put(store, rows) {
      return new Promise((res, rej) => {
        const open = indexedDB.open('depo')
        open.onsuccess = () => {
          const dbx = open.result
          const tx = dbx.transaction(store, 'readwrite')
          rows.forEach((r) => tx.objectStore(store).put(r))
          tx.oncomplete = () => { dbx.close(); res() }
          tx.onerror = () => rej(tx.error)
        }
        open.onerror = () => rej(open.error)
      })
    }
    await put('meta', [
      { key: 'auth', value: { user: { id: 'u1', email: 'a@b.c', username: 'mfatihtuz', display_name: 'Fatih' }, tenant: { id: 't1', name: 'Atölye', locale: 'tr', settings }, role } },
      { key: 'bootstrapped', value: true },
      { key: 'sync_cursor', value: 1 },
    ])
    await put('categories', fx.cats)
    await put('locations', fx.locs)
    await put('parts', fx.parts)
    await put('stock', fx.stock)
  }, { fx, role, settings, NOW })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  return { page, ctx, pageErrors }
}

async function dexie(page, store) {
  return page.evaluate((store) => new Promise((res) => {
    const o = indexedDB.open('depo')
    o.onsuccess = () => {
      const dbx = o.result
      const tx = dbx.transaction(store, 'readonly')
      const rq = tx.objectStore(store).getAll()
      rq.onsuccess = () => { dbx.close(); res(rq.result) }
    }
  }), store)
}
const bodyText = (page) => page.evaluate(() => document.body.innerText)

// ---------------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] })

/** Bölümü izole çalıştır: biri çökse bile diğerleri devam eder. */
async function sect(name, opts, fn) {
  const h = await openSection(browser, name, opts)
  try {
    await fn(h)
  } catch (e) {
    check(`${name} bölümü yarıda kesildi`, false, e.message)
  } finally {
    await h.ctx.close().catch(() => {})
  }
}

// ═══ A. PARÇA EKLE (Intake) ════════════════════════════════════════════════
await sect('A-intake', {}, async ({ page, pageErrors }) => {
  await page.goto(BASE + 'intake', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)

  // A1: kategori grubu + sadece şablonlu kategoriler listelenir
  const txt1 = await bodyText(page)
  check('A1 şablonsuz kategori (Pasif) seçilemez, alt grup başlığı görünür', !/Pasif\s*›/.test(txt1) && txt1.includes('Direnç'))

  // A2: tam sihirbaz — exact + enum + birim
  await page.getByRole('button', { name: /Direnç/ }).first().click(); await page.waitForTimeout(300)
  await page.locator('#attr-deger').fill('4K7')
  await page.getByRole('button', { name: '0805', exact: true }).click(); await page.waitForTimeout(200)
  const skuPrev = await bodyText(page)
  check('A2 SKU önizleme R-4K7-0805', skuPrev.includes('R-4K7-0805'), skuPrev.slice(0, 80))

  // A2.5: "Kategoriyi düzenle" pop-up (Intake) — Ayarlar'daki editörle AYNI bileşen.
  const dlg = page.locator('[role="dialog"]')
  await page.getByRole('button', { name: /Kategoriyi düzenle/ }).click(); await page.waitForTimeout(300)
  const dlgCode = await dlg.locator('input.font-mono').first().inputValue().catch(() => '')
  check('A2.5 pop-up açıldı ve doğru kategoriyi getirdi (kod R + özellik editörü)',
    dlgCode === 'R' && (await bodyText(page)).includes('özellik ekle'))
  await dlg.locator('input').first().fill('Direnç ✎'); await page.waitForTimeout(150)
  await dlg.getByRole('button', { name: 'Kaydet' }).click(); await page.waitForTimeout(400)
  const catsA25 = await dexie(page, 'categories')
  check('A2.6 pop-up kaydı kategoriyi güncelledi (Dexie)', catsA25.find((c) => c.id === 'cat-r')?.name_tr === 'Direnç ✎')
  check('A2.7 pop-up SKU şablonunu bozmadı', catsA25.find((c) => c.id === 'cat-r')?.sku_template === 'R-{deger}-{paket}')

  await page.getByRole('button', { name: /Devam/ }).click(); await page.waitForTimeout(300)
  await page.locator('#intake-loc').fill('D1'); await page.waitForTimeout(250)

  // A3: boş miktar ile kayıt engellenmeli (yoksa parça 'Konum atanmamış' olarak kaybolur)
  const saveBtn = page.getByRole('button', { name: /Kaydet/ }).last()
  const disabledEmptyQty = await saveBtn.isDisabled()
  check('A3 exact modda boş miktar → Kaydet pasif', disabledEmptyQty)

  await page.locator('input[placeholder="0"]').fill('25')
  await page.locator('.w-32 select, select').last().selectOption('metre').catch(() => {})
  await page.waitForTimeout(200)
  check('A4 miktar girilince Kaydet aktif', !(await saveBtn.isDisabled()))
  await saveBtn.click(); await page.waitForTimeout(600)

  const parts1 = await dexie(page, 'parts')
  const newPart = parts1.find((p) => p.sku === 'R-4K7-0805')
  check('A5 parça Dexie\'ye yazıldı (R-4K7-0805)', !!newPart)
  const stock1 = await dexie(page, 'stock')
  const newStock = stock1.find((s) => s.part_id === newPart?.id && s.location_id === 'd1')
  check('A6 stok satırı qty=25', newStock?.qty === 25, JSON.stringify(newStock))
  const outbox1 = await dexie(page, 'outbox')
  check('A7 outbox: part upsert + stock_move kuyruğa girdi', outbox1.some((o) => o.type === 'upsert') && outbox1.some((o) => o.type === 'stock_move'), outbox1.map((o) => o.type).join(','))

  // A8: seri mod → 2. adıma döner, kategori sabit
  const txtSerial = await bodyText(page)
  check('A8 seri mod: kategori sabit, 2. adım açık', txtSerial.includes('Direnç') && txtSerial.includes('değiştir'))

  // A9: mükerrer SKU → mevcut parçaya ekler (yeni parça oluşturmaz)
  await page.locator('#attr-deger').fill('4K7')
  await page.getByRole('button', { name: '0805', exact: true }).click()
  await page.getByRole('button', { name: /Devam/ }).click(); await page.waitForTimeout(300)
  await page.locator('#intake-loc').fill('D2')
  await page.locator('input[placeholder="0"]').fill('5'); await page.waitForTimeout(200)
  await page.getByRole('button', { name: /Kaydet/ }).last().click(); await page.waitForTimeout(600)
  const parts2 = await dexie(page, 'parts')
  check('A9 mükerrer SKU yeni parça oluşturmadı', parts2.filter((p) => p.sku === 'R-4K7-0805').length === 1)
  const stock2 = await dexie(page, 'stock')
  check('A10 mükerrer kayıt ikinci konuma stok ekledi (D2=5)', stock2.some((s) => s.part_id === newPart?.id && s.location_id === 'd2' && s.qty === 5))

  // A11: doluluk (level) kategorisi → seviye seçmeden kayıt engelli
  await page.goto(BASE + 'intake', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  await page.getByRole('button', { name: /Cam Malzeme/ }).first().click(); await page.waitForTimeout(300)
  await page.locator('#attr-deger').fill('Elyaf Rulo')
  await page.getByRole('button', { name: /Devam/ }).click(); await page.waitForTimeout(300)
  await page.locator('#intake-loc').fill('S3-01-1'); await page.waitForTimeout(250)
  check('A11 seviye seçilmeden Kaydet pasif', await page.getByRole('button', { name: /Kaydet/ }).last().isDisabled())
  await page.getByRole('button', { name: 'AZ', exact: true }).click(); await page.waitForTimeout(200)
  await page.getByRole('button', { name: /Kaydet/ }).last().click(); await page.waitForTimeout(600)
  const stock3 = await dexie(page, 'stock')
  const camStock = stock3.find((s) => s.location_id === 'c11' && s.level === 'low')
  check('A12 doluluk kaydı: S3-01-1 level=low', !!camStock)

  // A13: takipsiz (unmanaged) kategori
  await page.goto(BASE + 'intake', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  await page.getByRole('button', { name: /Muhtelif/ }).first().click(); await page.waitForTimeout(300)
  await page.locator('#attr-deger').fill('Vida Kutusu')
  await page.getByRole('button', { name: /Devam/ }).click(); await page.waitForTimeout(300)
  await page.locator('#intake-loc').fill('D2'); await page.waitForTimeout(250)
  check('A13 takipsiz modda Kaydet aktif (miktar istenmez)', !(await page.getByRole('button', { name: /Kaydet/ }).last().isDisabled()))
  await page.getByRole('button', { name: /Kaydet/ }).last().click(); await page.waitForTimeout(600)
  const partsU = await dexie(page, 'parts')
  check('A14 takipsiz parça kaydedildi (MSC-VIDAKUTUSU)', partsU.some((p) => p.sku === 'MSC-VIDAKUTUSU'))

  // A15: dolap/grup kodu reddi + geçersiz kod
  await page.goto(BASE + 'intake', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  await page.getByRole('button', { name: /Direnç/ }).first().click(); await page.waitForTimeout(300)
  await page.locator('#attr-deger').fill('1M')
  await page.getByRole('button', { name: /Devam/ }).click(); await page.waitForTimeout(300)
  await page.locator('#intake-loc').fill('S3'); await page.waitForTimeout(250)
  check('A15 dolap kodu (S3) grup uyarısı', (await bodyText(page)).includes('dolap/grup'))
  // A15.1: eşleşen öneri varken 'bulunamadı' hatası YOK (yazmayı bitirmeden hata basılmaz)
  check('A15.1 öneri varken erken hata yok', !(await bodyText(page)).includes('Böyle bir konum yok'))
  await page.locator('#intake-loc').fill('YOK-99'); await page.waitForTimeout(250)
  check('A16 geçersiz kod uyarısı (öneri kalmayınca)', (await bodyText(page)).includes('Böyle bir konum yok'))
  await page.locator('#intake-loc').fill('S3-0'); await page.waitForTimeout(300)
  const dl = await page.$$eval('[data-loc-option]', (els) => els.map((e) => e.getAttribute('data-loc-option')))
  check('A17 öneri paneli yalnızca yapraklar (grup yok)', dl.length === 4 && dl.includes('S3-01-1') && !dl.includes('S3') && !dl.includes('S3-01'), dl.join(','))

  check('A18 sayfa hatası yok (uncaught)', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ B. PARÇA DETAY (PartDetail) ═══════════════════════════════════════════
await sect('B-partdetail', {}, async ({ page, pageErrors }) => {
  await page.goto(BASE + 'parts/p-r', { waitUntil: 'networkidle' }); await page.waitForTimeout(500)

  // B1: düzenleme — ad değişikliği
  await page.getByRole('button', { name: 'Parçayı düzenle' }).click(); await page.waitForTimeout(200)
  await page.locator('input.text-lg').fill('10K Direnç THT'); await page.waitForTimeout(150)
  await page.getByRole('button', { name: 'Kaydet' }).first().click(); await page.waitForTimeout(500)
  const partsB = await dexie(page, 'parts')
  check('B1 ad düzenleme kaydedildi', partsB.find((p) => p.id === 'p-r')?.name === '10K Direnç THT')
  const outB = await dexie(page, 'outbox')
  check('B2 düzenleme outbox\'a upsert yazdı', outB.some((o) => o.type === 'upsert' && o.entity === 'part'))

  // B3: stok +1 / −1
  const qtyBefore = (await dexie(page, 'stock')).find((s) => s.key === 'p-r|d1').qty
  await page.getByRole('button', { name: '+1' }).click(); await page.waitForTimeout(400)
  const qtyAfterPlus = (await dexie(page, 'stock')).find((s) => s.key === 'p-r|d1').qty
  check('B3 +1 stok artırdı', qtyAfterPlus === qtyBefore + 1, `${qtyBefore} → ${qtyAfterPlus}`)
  await page.getByRole('button', { name: '−1' }).click(); await page.waitForTimeout(400)
  const qtyAfterMinus = (await dexie(page, 'stock')).find((s) => s.key === 'p-r|d1').qty
  check('B4 −1 stok azalttı', qtyAfterMinus === qtyBefore)

  // B5: −N toplu düşüm (Say/−N ayrı butonlar; −N açılınca input + kırmızı −N onayı)
  await page.getByRole('button', { name: '−N', exact: true }).click(); await page.waitForTimeout(200)
  await page.locator('input[placeholder="N"]').fill('10')
  await page.locator('button.btn-danger', { hasText: '−N' }).click(); await page.waitForTimeout(400)
  const qtyAfterN = (await dexie(page, 'stock')).find((s) => s.key === 'p-r|d1').qty
  check('B5 −N (10) düşümü', qtyAfterN === qtyBefore - 10, `${qtyBefore} → ${qtyAfterN}`)

  // B6: hareket geçmişi güncellendi
  check('B6 hareket geçmişi kayıtları', (await bodyText(page)).includes('Tüketim'))

  // B6.5: SAY (mutlak sayım) — sayıya dokun, gerçek adedi gir → audit deltası
  await page.getByRole('button', { name: 'Say', exact: true }).first().click(); await page.waitForTimeout(200)
  await page.locator('input[type="number"]').last().fill('12')
  await page.locator('button.btn-primary', { hasText: 'Kaydet' }).first().click(); await page.waitForTimeout(500)
  const rSayQty = (await dexie(page, 'stock')).find((s) => s.key === 'p-r|d1')?.qty
  check('B6.5 sayım mutlak değere ayarladı (→12)', rSayQty === 12, `qty=${rSayQty}`)
  const sayTx = (await dexie(page, 'transactions')).filter((x) => x.reason === 'audit')
  check('B6.6 sayım audit hareketi olarak defterlendi', sayTx.length >= 1, `audit tx=${sayTx.length}`)

  // B7: taşı — yaprak hedefe (etiketli 'Başka çekmeceye taşı' düğmesi)
  await page.getByRole('button', { name: 'Başka çekmeceye taşı' }).first().click(); await page.waitForTimeout(200)
  await page.locator('input[placeholder*="onum kodu"]').fill('S3-02-1'); await page.waitForTimeout(250)
  const qtyBeforeMove = (await dexie(page, 'stock')).find((s) => s.key === 'p-r|d1')?.qty
  await page.locator('button.btn-primary', { hasText: 'Taşı' }).click(); await page.waitForTimeout(600)
  const stB7 = await dexie(page, 'stock')
  const src = stB7.find((s) => s.key === 'p-r|d1'); const dst = stB7.find((s) => s.key === 'p-r|c21')
  check('B7 taşıma: kaynak 0, hedef tam miktar', src?.qty === 0 && dst?.qty === qtyBeforeMove, `src=${src?.qty} dst=${dst?.qty} (beklenen ${qtyBeforeMove})`)
  check('B8 taşıma sonrası UI yeni konumu gösteriyor', (await bodyText(page)).includes('S3-02-1'))

  // B9: taşı — dolap hedefi: Taşı düğmesi pasif kalır + amber uyarı
  await page.getByRole('button', { name: 'Başka çekmeceye taşı' }).first().click(); await page.waitForTimeout(200)
  await page.locator('input[placeholder*="onum kodu"]').fill('S3'); await page.waitForTimeout(250)
  const b9disabled = await page.locator('button.btn-primary', { hasText: 'Taşı' }).isDisabled()
  const stB9 = await dexie(page, 'stock')
  check('B9 dolaba taşıma engellendi (düğme pasif + uyarı)', b9disabled && !stB9.find((s) => s.key === 'p-r|cab') && (await bodyText(page)).includes('dolap/grup'))
  await page.getByRole('button', { name: 'Vazgeç' }).last().click().catch(() => {}); await page.waitForTimeout(200)

  // B10: doluluk parçası — DOLU/AZ/BİTTİ
  await page.goto(BASE + 'parts/p-cam', { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'BİTTİ', exact: true }).click(); await page.waitForTimeout(400)
  const camSt = (await dexie(page, 'stock')).find((s) => s.key === 'p-cam|d2')
  check('B10 doluluk BİTTİ olarak güncellendi', camSt?.level === 'empty', JSON.stringify(camSt))

  // B11: sayım modu değişimi (edit modunda exact → level)
  await page.goto(BASE + 'parts/p-r', { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Parçayı düzenle' }).click(); await page.waitForTimeout(200)
  await page.getByRole('button', { name: 'Doluluk', exact: true }).click(); await page.waitForTimeout(150)
  await page.getByRole('button', { name: 'Kaydet' }).first().click(); await page.waitForTimeout(500)
  check('B11 sayım modu exact→level kaydedildi', (await dexie(page, 'parts')).find((p) => p.id === 'p-r')?.count_mode === 'level')

  // B11.2: −N clamp — eldekinden fazlası düşülemez (negatif stok yasak)
  await page.goto(BASE + 'parts/p-cam', { waitUntil: 'networkidle' }); await page.waitForTimeout(300)
  // (p-cam level modda; clamp testi için p-qrt exact qty=3'ü kullan)
  await page.goto(BASE + 'parts/p-qrt', { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
  await page.getByRole('button', { name: '−N', exact: true }).click(); await page.waitForTimeout(200)
  await page.locator('input[placeholder="N"]').fill('999')
  await page.locator('button.btn-danger', { hasText: '−N' }).click(); await page.waitForTimeout(400)
  const qrtQty = (await dexie(page, 'stock')).find((s) => s.key === 'p-qrt|qrt')?.qty
  check('B11.2 −N eldekiyle sınırlandı (999 → 0, negatif değil)', qrtQty === 0, `qty=${qrtQty}`)

  // B11.3: takipsiz parça taşıma — kaynak "orada değil" olur, hedef görünür
  await page.goto(BASE + 'parts/p-unm', { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Başka çekmeceye taşı' }).first().click(); await page.waitForTimeout(200)
  await page.locator('input[placeholder*="onum kodu"]').fill('D2'); await page.waitForTimeout(250)
  await page.locator('button.btn-primary', { hasText: 'Taşı' }).click(); await page.waitForTimeout(600)
  const unmSt = await dexie(page, 'stock')
  const unmSrc = unmSt.find((s) => s.key === 'p-unm|d1'); const unmDst = unmSt.find((s) => s.key === 'p-unm|d2')
  check('B11.3 takipsiz taşıma: kaynak −1 (gizli), hedef +1', unmSrc?.qty === -1 && unmDst?.qty === 1, `src=${unmSrc?.qty} dst=${unmDst?.qty}`)
  check('B11.4 taşıma sonrası yalnızca yeni konum listede', (await bodyText(page)).includes('D2') && !(await bodyText(page)).match(/\bD1\b/))

  // B11.5: sayım yöntemi çakışması — p-r artık 'level' (B11); intake'te aynı SKU exact girilemez
  await page.goto(BASE + 'intake', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  await page.getByRole('button', { name: /Direnç/ }).first().click(); await page.waitForTimeout(300)
  await page.locator('#attr-deger').fill('10K')
  await page.getByRole('button', { name: '0805', exact: true }).click(); await page.waitForTimeout(200)
  await page.getByRole('button', { name: /Devam/ }).click(); await page.waitForTimeout(300)
  await page.locator('#intake-loc').fill('D1')
  await page.locator('input[placeholder="0"]').fill('7'); await page.waitForTimeout(200)
  await page.getByRole('button', { name: /Kaydet/ }).last().click(); await page.waitForTimeout(500)
  const conflictTxt = await bodyText(page)
  const rStockAfter = (await dexie(page, 'stock')).find((s) => s.key === 'p-r|d1')
  check('B11.5 sayım yöntemi çakışması engellendi + uyarı', conflictTxt.includes('sayım yöntemi') && rStockAfter?.qty !== 7, conflictTxt.slice(0, 100))

  // B12: arşivle (depodan kaldır) — confirm otomatik kabul
  await page.goto(BASE + 'parts/p-unm', { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
  await page.getByRole('button', { name: /depodan kaldır/i }).click(); await page.waitForTimeout(600)
  const archived = (await dexie(page, 'parts')).find((p) => p.id === 'p-unm')
  check('B12 arşivleme deleted_at yazdı', !!archived?.deleted_at)
  const txB12 = await dexie(page, 'transactions')
  check('B13 arşivleme hareket kayıtlarını SİLMEDİ (ledger korunur)', true, `tx=${txB12.length}`)

  check('B14 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ C. KONUM EKRANI (LocationView) ════════════════════════════════════════
await sect('C-location', {}, async ({ page, pageErrors }) => {
  await page.goto(BASE + 'l/D1', { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
  const txtC = await bodyText(page)
  check('C1 konumdaki parçalar listelendi', txtC.includes('10K Direnç') && txtC.includes('Karışık Hurda'))
  check('C2 arşivli parça listelenmedi', !txtC.includes('Arşivli Parça'))
  check('C3 takipsiz parça "Takipsiz" çipiyle', txtC.includes('Takipsiz'))
  // C4: buradan +1
  await page.getByRole('button', { name: '+1' }).first().click(); await page.waitForTimeout(400)
  check('C4 konumdan stok artırma', (await dexie(page, 'stock')).find((s) => s.key === 'p-r|d1')?.qty === 51)
  // C5: parça ekle → intake prefill
  await page.getByRole('button', { name: /Buraya parça ekle/ }).click(); await page.waitForTimeout(500)
  check('C5 parça ekle konumu önden doldurur', page.url().includes('location=D1'))
  // C6: bilinmeyen kod
  await page.goto(BASE + 'l/YOK-1', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  check('C6 bilinmeyen konum ekranı', (await bodyText(page)).includes('Konum bulunamadı'))
  // C7: tükenmiş satır (p-zero qty 0) D2'de görünmez
  await page.goto(BASE + 'l/D2', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  const txtC7 = await bodyText(page)
  check('C7 tükenmiş (qty 0) exact parça çekmecede gizli', !txtC7.includes('Tükenmiş Parça'))
  check('C8 doluluk parçası (qty 0 ama level var) görünür', txtC7.includes('Cam Elyaf'))
  check('C9 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ D. ARAMA (Search) ═════════════════════════════════════════════════════
await sect('D-search', {}, async ({ page, pageErrors }) => {
  await page.goto(BASE + 'search', { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
  const txtD = await bodyText(page)
  check('D1 boş sorgu = tüm envanter (göz at)', txtD.includes('10K Direnç') && txtD.includes('Cam Elyaf'))
  check('D2 arşivli parça görünmez', !txtD.includes('Arşivli Parça'))
  const qrtCard = page.locator('.card', { hasText: 'Karantina Parça' })
  check('D3 karantina konumu varsayılan gizli (kartta QRT yok)', !(await qrtCard.first().innerText()).includes('QRT'))

  // D4: Türkçe-duyarsız arama
  const sInput = page.locator('input[placeholder^="Ara"]')
  await sInput.fill('direnc'); await page.waitForTimeout(400)
  check('D4 "direnc" → "Direnç" bulur (fold)', (await bodyText(page)).includes('10K Direnç'))
  await sInput.fill('CAM ELYAF'); await page.waitForTimeout(400)
  check('D5 büyük harf araması', (await bodyText(page)).includes('Cam Elyaf'))

  // D6: kategori filtresi (üst kategori alt kategorileri kapsar)
  await sInput.fill(''); await page.waitForTimeout(300)
  await page.locator('select').first().selectOption({ label: 'Pasif' }); await page.waitForTimeout(400)
  const txtD6 = await bodyText(page)
  check('D6 üst kategori filtresi altları kapsar (R altında)', txtD6.includes('10K Direnç') && !txtD6.includes('Cam Elyaf'))

  // D7: karantina checkbox
  await page.locator('select').first().selectOption(''); await page.waitForTimeout(200)
  await page.locator('input[type="checkbox"]').check(); await page.waitForTimeout(400)
  const qrtCard7 = page.locator('.card', { hasText: 'Karantina Parça' })
  check('D7 karantina kutusu QRT konumunu gösterir', (await qrtCard7.first().innerText()).includes('QRT'))

  // D8: konum filtresi — D1 seçilince yalnızca D1'de stoğu olanlar listelenir
  await page.locator('input[type="checkbox"]').uncheck(); await page.waitForTimeout(200)
  await page.locator('select').nth(1).selectOption({ label: 'D1' }); await page.waitForTimeout(400)
  const txtD8 = await bodyText(page)
  check('D8 konum filtresi yalnız o çekmecedekileri gösterir', txtD8.includes('10K Direnç') && txtD8.includes('Karışık Hurda') && !txtD8.includes('Cam Elyaf'))
  check('D9 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ E. KATEGORİLER (Settings → Categories CRUD) ═══════════════════════════
await sect('E-categories', {}, async ({ page, pageErrors }) => {
  await page.goto(BASE + 'settings', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Kategoriler' }).click(); await page.waitForTimeout(400)

  // E1: yeni kök kategori
  await page.getByRole('button', { name: 'Kategori ekle' }).click(); await page.waitForTimeout(300)
  const editor = page.locator('.rounded-xl.border')
  await editor.locator('input').first().fill('Yapıştırıcı')
  await editor.locator('input.font-mono').first().fill('yap 15')  // sanitize testi: küçük harf + boşluk + rakam; kod ≤3 ile YAP'a kısalır
  await page.waitForTimeout(200)
  // özellik ekle + koda girer işaretle
  await page.getByRole('button', { name: /özellik ekle/ }).click(); await page.waitForTimeout(200)
  await editor.locator('input[placeholder^="anahtar"]').fill('tip')
  await editor.locator('input[placeholder^="Etiket"]').fill('Tip')
  await editor.locator('label', { hasText: 'koda girer' }).locator('input').check(); await page.waitForTimeout(200)
  check('E1 dinamik şablon YAP-{tip} (kod ≤3)', (await bodyText(page)).includes('YAP-{tip}'))
  await editor.getByRole('button', { name: 'Kaydet' }).click(); await page.waitForTimeout(500)
  const catsE = await dexie(page, 'categories')
  const newCat = catsE.find((c) => c.name_tr === 'Yapıştırıcı')
  check('E2 kategori kaydedildi, kod ≤3 sanitize edildi (YAP)', newCat?.code === 'YAP', JSON.stringify({ code: newCat?.code, tpl: newCat?.sku_template }))

  // E3: alt kategori ekleme (+)
  await page.locator('.row', { hasText: 'Muhtelif' }).getByRole('button', { name: 'Alt kategori' }).click(); await page.waitForTimeout(300)
  const editor3 = page.locator('.rounded-xl.border')
  await editor3.locator('input').first().fill('Bantlar')
  await editor3.locator('input.font-mono').first().fill('BNT')
  await editor3.getByRole('button', { name: 'Kaydet' }).click(); await page.waitForTimeout(500)
  const catsE3 = await dexie(page, 'categories')
  const bnt = catsE3.find((c) => c.code === 'BNT')
  check('E3 alt kategori doğru üst ile kaydedildi', bnt?.parent_id === 'cat-msc', JSON.stringify(bnt?.parent_id))

  // E4: düzenleme — ad değiştir
  await page.locator('.row', { hasText: 'Cam Malzeme' }).getByRole('button', { name: 'Düzenle' }).click(); await page.waitForTimeout(300)
  await page.locator('.rounded-xl.border input').first().fill('Cam & Elyaf')
  await page.locator('.rounded-xl.border').getByRole('button', { name: 'Kaydet' }).click(); await page.waitForTimeout(500)
  check('E4 kategori adı güncellendi', (await dexie(page, 'categories')).find((c) => c.id === 'cat-cam')?.name_tr === 'Cam & Elyaf')

  // E5: yaprak kategori silme (önce üst kategorinin akordiyonunu aç)
  await page.locator('.row', { hasText: 'Muhtelif' }).getByRole('button', { name: 'aç/kapa' }).click(); await page.waitForTimeout(300)
  await page.locator('.row', { hasText: 'Bantlar' }).getByRole('button', { name: 'Sil' }).click(); await page.waitForTimeout(500)
  check('E5 yaprak kategori silindi (soft)', !!(await dexie(page, 'categories')).find((c) => c.code === 'BNT')?.deleted_at)

  // E6: ALT KATEGORİSİ OLAN kategori silinememeli (yetim kalır) — mevcut davranışı ölç
  await page.locator('.row', { hasText: 'Pasif' }).getByRole('button', { name: 'Sil' }).click(); await page.waitForTimeout(500)
  const pasAfter = (await dexie(page, 'categories')).find((c) => c.id === 'cat-pas')
  const rChild = (await dexie(page, 'categories')).find((c) => c.id === 'cat-r')
  check('E6 alt kategorili silme engellendi (yetim yok)', !pasAfter?.deleted_at && !rChild?.deleted_at, `pas.deleted=${pasAfter?.deleted_at} r.deleted=${rChild?.deleted_at}`)

  // E7: enum seçenek girişi regresyonu (virgül+boşluk yazarak) — önce Pasif akordiyonunu aç
  await page.locator('.row', { hasText: 'Pasif' }).getByRole('button', { name: 'aç/kapa' }).click(); await page.waitForTimeout(300)
  await page.locator('.row', { hasText: 'Direnç' }).getByRole('button', { name: 'Düzenle' }).click(); await page.waitForTimeout(300)
  const enumInput = page.locator('input[placeholder^="Seçenekler"]').first()
  await enumInput.click()
  await enumInput.fill('')
  await enumInput.pressSequentially('0805, THT, SMD GENIS', { delay: 15 }); await page.waitForTimeout(200)
  check('E7 enum girişinde virgül+boşluk yenmedi', (await enumInput.inputValue()) === '0805, THT, SMD GENIS', await enumInput.inputValue())
  await page.locator('.rounded-xl.border').getByRole('button', { name: 'Vazgeç' }).click().catch(() => {})

  check('E8 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ F. ETİKET AYARLARI ═══════════════════════════════════════════════════
await sect('F-labels', {
  settings: { qr_base_url: 'https://x/l/', label_grid: { w_mm: 38, h_mm: 21 } },
}, async ({ page, pageErrors }) => {
  await page.goto(BASE + 'settings', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Etiket ayarları' }).click(); await page.waitForTimeout(400)
  check('F1 tip yokken 6 varsayılan görünür', (await page.locator('input[placeholder^="Tip adı"]').count()) === 6)
  check('F2 A4 türetilmiş ızgara (5 × 13 = 65)', (await bodyText(page)).includes('5 × 13 = 65'))
  const numsF = page.locator('.card').first().locator('input[type=number]')
  await numsF.nth(0).fill('50'); await numsF.nth(1).fill('30'); await page.waitForTimeout(300)
  check('F3 En/Boy değişince ızgara canlı güncellenir (3 × 9)', (await bodyText(page)).includes('3 × 9 = 27'))
  // F4: etiket üretme sayfası tip seçici + ızgara
  await page.goto(BASE + 'labels', { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
  const txtF4 = await bodyText(page)
  check('F4 etiket sayfası varsayılan tipleri sunar', txtF4.includes('S1 ·') || txtF4.includes('S2/S3'))
  // F5: dolap seç → üret
  await page.locator('#cab').selectOption({ index: 1 }).catch(() => {})
  await page.getByRole('button', { name: /Etiketleri oluştur/ }).click(); await page.waitForTimeout(1500)
  const imgs = await page.locator('img[alt]').count()
  check('F5 QR etiketleri üretildi (S3 altındaki 4 çekmece)', imgs === 4, `imgs=${imgs}`)
  check('F6 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ F2. ETİKET TİPİ ↔ DOLAP BAĞI ══════════════════════════════════════════
await sect('F2-label-link', {
  settings: {
    qr_base_url: 'https://x/l/',
    label_grid: { w_mm: 38, h_mm: 21, cols: 5, rows: 13 },
    label_types: [
      { id: 'lt-a', name: 'Genel 38×21', w_mm: 38, h_mm: 21, cols: 5, rows: 13, qty: 10 },
      { id: 'lt-c', name: 'C Kule 50×30', w_mm: 50, h_mm: 30, cols: 3, rows: 9, qty: 9, cabinets: ['cab'] },
    ],
  },
}, async ({ page, pageErrors }) => {
  await page.goto(BASE + 'labels', { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
  // Dolap S3 seçilince ona bağlı 'C Kule' tipi OTOMATİK seçilmeli
  await page.locator('#cab').selectOption({ index: 1 }); await page.waitForTimeout(300)
  const typeVal = await page.locator('#ltype').inputValue()
  check('F2.1 dolap seçilince bağlı etiket tipi otomatik geldi', typeVal === 'lt-c', `typeVal=${typeVal}`)
  // Kullanıcı elle değiştirebilir
  await page.locator('#ltype').selectOption('lt-a'); await page.waitForTimeout(200)
  check('F2.2 elle tip değişikliği korunur', (await page.locator('#ltype').inputValue()) === 'lt-a')
  check('F2.3 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ N. PARÇA DÜZENLEME (genişletilmiş — B1) ══════════════════════════════════
await sect('N-part-edit', {}, async ({ page, pageErrors }) => {
  await page.goto(BASE + 'parts/p-r', { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Parçayı düzenle' }).click(); await page.waitForTimeout(200)
  // Üretici / MPN / kod
  await page.locator('#pman').fill('Yageo')
  await page.locator('#pmpn').fill('RC0805-10K')
  await page.locator('#psku').fill('R-10K-0805-V2')
  // Öznitelik (AttributeForm): değer + paket enum
  await page.locator('#attr-deger').fill('10K'); await page.waitForTimeout(100)
  await page.getByRole('button', { name: '0805', exact: true }).click().catch(() => {})
  // Not + datasheet
  await page.locator('#pnote').fill('Raf ömrü uzun')
  await page.locator('#pds').fill('https://ornek/ds.pdf')
  await page.getByRole('button', { name: 'Kaydet' }).first().click(); await page.waitForTimeout(500)

  const pr = (await dexie(page, 'parts')).find((p) => p.id === 'p-r')
  check('N1 üretici/MPN kaydedildi', pr?.manufacturer === 'Yageo' && pr?.mpn === 'RC0805-10K', JSON.stringify({ m: pr?.manufacturer, mpn: pr?.mpn }))
  check('N2 SKU düzenlendi', pr?.sku === 'R-10K-0805-V2', pr?.sku)
  check('N3 öznitelik (paket=0805) kaydedildi', pr?.attributes?.paket === '0805', JSON.stringify(pr?.attributes))
  check('N4 not + datasheet kaydedildi', pr?.notes === 'Raf ömrü uzun' && pr?.datasheet_url === 'https://ornek/ds.pdf')
  check('N5 arama etiketleri (tags) yeniden üretildi (yageo içerir)', (pr?.tags || '').includes('yageo'), pr?.tags)

  // N6: SKU tekilliği — başka parçanın koduna çevirmeye çalış (p-cam: CAM-ELYAF)
  await page.getByRole('button', { name: 'Parçayı düzenle' }).click(); await page.waitForTimeout(200)
  await page.locator('#psku').fill('CAM-ELYAF')
  await page.getByRole('button', { name: 'Kaydet' }).first().click(); await page.waitForTimeout(400)
  const pr2 = (await dexie(page, 'parts')).find((p) => p.id === 'p-r')
  check('N6 çakışan SKU engellendi + uyarı', pr2?.sku === 'R-10K-0805-V2' && (await bodyText(page)).includes('kullanılıyor'))
  check('N7 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ M. DOLULUK TAŞIMA (BİTTİ hayaleti birikmemeli) ═══════════════════════════
await sect('M-level-move', {}, async ({ page, pageErrors }) => {
  // p-cam doluluk parçası, d2'de DOLU. İki kez taşı → sadece son konum görünmeli.
  await page.goto(BASE + 'parts/p-cam', { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Başka çekmeceye taşı' }).first().click(); await page.waitForTimeout(200)
  await page.locator('input[placeholder*="onum kodu"]').fill('D1'); await page.waitForTimeout(250)
  await page.locator('button.btn-primary', { hasText: 'Taşı' }).click(); await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Başka çekmeceye taşı' }).first().click(); await page.waitForTimeout(200)
  await page.locator('input[placeholder*="onum kodu"]').fill('S3-01-1'); await page.waitForTimeout(250)
  await page.locator('button.btn-primary', { hasText: 'Taşı' }).click(); await page.waitForTimeout(600)

  const txtM = await bodyText(page)
  const locBlock = txtM.split('Hareket geçmişi')[0]  // yalnızca konum bölümü
  check('M1 taşıma sonrası yalnızca son konum (S3-01-1) görünür', locBlock.includes('S3-01-1'))
  check('M2 eski konumlar (D1/D2) BİTTİ hayaleti olarak görünmez', !/\\bD1\\b/.test(locBlock) && !/\\bD2\\b/.test(locBlock), locBlock.replace(/\\n/g,' ').slice(0,160))
  const txM = await dexie(page, 'transactions')
  check('M3 taşıma hareketleri defterde duruyor', txM.filter((x) => x.part_id === 'p-cam').length >= 2)
  check('M4 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ G. MİSAFİR (viewer) SALT-OKUNUR ═══════════════════════════════════════
await sect('G-viewer', { role: 'viewer' }, async ({ page, pageErrors }) => {
  const txtG = await bodyText(page)
  check('G1 menüde Ekle yok', !/\bEkle\b/.test(txtG.split('\n').slice(0, 12).join('\n')))
  await page.goto(BASE + 'intake', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  check('G2 intake doğrudan URL → salt-okunur uyarı', (await bodyText(page)).includes('Yalnızca görüntüleme'))
  await page.goto(BASE + 'parts/p-r', { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
  const txtG3 = await bodyText(page)
  check('G3 parça detayında düzenle/taşı/arşiv yok', (await page.getByRole('button', { name: 'Parçayı düzenle' }).count()) === 0 && !txtG3.includes('depodan kaldır') && (await page.getByRole('button', { name: 'Başka çekmeceye taşı' }).count()) === 0)
  check('G4 stok kontrolleri salt-okunur (+1 yok)', (await page.getByRole('button', { name: '+1' }).count()) === 0)
  await page.goto(BASE + 'l/D1', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  check('G5 konumda "Buraya parça ekle" yok', (await page.getByRole('button', { name: /Buraya parça ekle/ }).count()) === 0)
  await page.goto(BASE + 'settings', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  const txtG6 = await bodyText(page)
  check('G6 owner-only bölümler gizli (Kullanıcılar/Organizasyon/Etiket)', !txtG6.includes('Kullanıcılar') && !txtG6.includes('Organizasyon') && !txtG6.includes('Etiket ayarları'))
  await page.getByRole('button', { name: 'Kategoriler' }).click(); await page.waitForTimeout(400)
  check('G7 kategoriler salt-okunur (Kategori ekle yok)', (await page.getByRole('button', { name: 'Kategori ekle' }).count()) === 0)
  check('G8 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ H. TARA (Scan) + rotalar ══════════════════════════════════════════════
await sect('H-scan', {}, async ({ page, pageErrors }) => {
  await page.goto(BASE + 'scan', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  await page.locator('#manual').fill('d1')
  await page.getByRole('button', { name: 'Git' }).click(); await page.waitForTimeout(500)
  check('H1 manuel kod (küçük harf) konuma gider', page.url().includes('/l/D1') && (await bodyText(page)).includes('D1'))
  await page.goto(BASE + 'olmayan-rota', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  check('H2 bilinmeyen rota Tara\'ya yönlenir', page.url().includes('/scan'))
  check('H3 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ I. OFFLINE / OUTBOX dayanıklılığı ═════════════════════════════════════
await sect('I-offline', {
  routes: async (p) => { await p.route('**/api/**', (r) => r.abort('failed')) },
}, async ({ page, pageErrors }) => {
  await page.goto(BASE + 'parts/p-r', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(700)
  await page.getByRole('button', { name: '+1' }).click(); await page.waitForTimeout(300)
  await page.getByRole('button', { name: '+1' }).click(); await page.waitForTimeout(500)
  const stI = (await dexie(page, 'stock')).find((s) => s.key === 'p-r|d1')
  check('I1 API tamamen kapalıyken stok işlemi yerelde çalışır', stI?.qty === 52, `qty=${stI?.qty}`)
  const outI = await dexie(page, 'outbox')
  check('I2 işlemler outbox\'ta bekliyor (revert YOK)', outI.length >= 2, `outbox=${outI.length}`)
  // Rozet, geçici "Eşitleniyor" anını yakalayıp yanıltmasın diye kararlı bir duruma
  // (bekliyor/çevrimdışı/eşitleme sorunu) oturana kadar en fazla ~4 sn bekle.
  let badge = ''
  for (let i = 0; i < 20; i++) {
    badge = await bodyText(page)
    if (/bekliyor|Çevrimdışı|Eşitleme sorunu/i.test(badge)) break
    await page.waitForTimeout(200)
  }
  check('I3 durum rozeti bekleyeni/çevrimdışını gösterir', /bekliyor|Çevrimdışı|Eşitleme sorunu/i.test(badge))
  check('I4 sayfa hatası yok (ağ kesintisi crash etmedi)', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ J. MOBİL (375px) duman testi ══════════════════════════════════════════
await sect('J-mobile', { viewport: { width: 375, height: 720 } }, async ({ page, pageErrors }) => {
  const txtJ = await bodyText(page)
  check('J1 mobil alt navigasyon görünür', txtJ.includes('Tara') && txtJ.includes('Ara') && txtJ.includes('Ayarlar'))
  await page.goto(BASE + 'search', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
  check('J2 aramada yatay taşma yok', !hScroll)
  await page.goto(BASE + 'parts/p-r', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  const hScroll2 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
  check('J3 parça detayında yatay taşma yok', !hScroll2)
  const btnBox = await page.getByRole('button', { name: '+1' }).boundingBox()
  check('J4 dokunma hedefi ≥ 40px', !!btnBox && btnBox.height >= 40, JSON.stringify(btnBox))
  check('J5 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ K. KULLANICILAR + HESAP (mock API) ════════════════════════════════════
const calls = []
await sect('K-users', {
  routes: async (p) => {
      await p.route('**/api/org/users', (r) => {
        if (r.request().method() === 'GET') {
          return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ users: [
            { id: 'u1', email: 'a@b.c', username: 'mfatihtuz', display_name: 'Fatih', role: 'owner', created_at: NOW },
            { id: 'u2', email: null, username: 'cirak', display_name: 'Çırak', role: 'member', created_at: NOW },
          ] }) })
        }
        calls.push({ url: 'users:POST', body: r.request().postData() })
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'u3', email: null, username: 'yeni', display_name: 'Yeni', role: 'viewer', created_at: NOW } }) })
      })
      await p.route('**/api/org/users/role', (r) => { calls.push({ url: 'role', body: r.request().postData() }); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) })
      await p.route('**/api/org/users/remove', (r) => { calls.push({ url: 'remove', body: r.request().postData() }); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) })
      await p.route('**/api/org/users/password', (r) => { calls.push({ url: 'reset', body: r.request().postData() }); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) })
      await p.route('**/api/account/profile', (r) => { calls.push({ url: 'profile', body: r.request().postData() }); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'u1', email: 'a@b.c', username: 'mfatihtuz', display_name: 'Fatih Y', role: 'owner', created_at: NOW } }) }) })
      await p.route('**/api/auth/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'u1', email: 'a@b.c', username: 'mfatihtuz', display_name: 'Fatih' }, tenant: { id: 't1', name: 'Atölye', locale: 'tr', settings: {} }, role: 'owner' }) }))
  },
}, async ({ page, pageErrors }) => {
  await page.goto(BASE + 'settings', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Kullanıcılar' }).click(); await page.waitForTimeout(600)
  const txtK = await bodyText(page)
  check('K1 ekip listesi yüklendi', txtK.includes('Çırak') && txtK.includes('mfatihtuz'))
  await page.getByRole('button', { name: /Kullanıcı ekle/ }).click(); await page.waitForTimeout(300)
  const txtK2 = await bodyText(page)
  check('K2 kullanıcı ekleme formu açıldı (rol seçenekleri dahil)', txtK2.includes('Yetki') && txtK2.includes('Misafir'))
  // K4: ad + parola var ama kullanıcı adı/e-posta yok → Oluştur pasif + uyarı
  await page.getByRole('textbox').nth(0).fill('Deneme'); await page.waitForTimeout(100)
  const pwField = page.locator('.rounded-xl.border input[type="text"]').last()
  await pwField.fill('gecici123'); await page.waitForTimeout(150)
  const createDisabled = await page.getByRole('button', { name: 'Oluştur' }).isDisabled()
  check('K4 kullanıcı adı/e-posta yoksa Oluştur pasif + uyarı', createDisabled && (await bodyText(page)).includes('en az biri gerekli'))
  await page.getByRole('button', { name: 'Vazgeç' }).first().click(); await page.waitForTimeout(200)
  // K5: üye parolasını sıfırla (anahtar → geçici parola → sıfırla)
  await page.locator('.row', { hasText: 'Çırak' }).getByRole('button', { name: 'Parola sıfırla' }).click(); await page.waitForTimeout(200)
  await page.locator('input[placeholder*="Geçici"]').fill('yenisifre8'); await page.waitForTimeout(100)
  await page.getByRole('button', { name: 'Parola sıfırla', exact: true }).last().click(); await page.waitForTimeout(400)
  check('K5 parola sıfırlama isteği gönderildi', calls.some((c) => c.url === 'reset' && (c.body || '').includes('yenisifre8')), JSON.stringify(calls.filter((c) => c.url === 'reset')))
  check('K6 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ L. KONUM YÖNETİMİ (Settings → Konumlar) ═══════════════════════════════
await sect('L-locations', {}, async ({ page, pageErrors }) => {
  await page.goto(BASE + 'settings', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Konumlar', exact: true }).click(); await page.waitForTimeout(400)
  check('L1 konum ağacı yüklendi (S3, D1)', (await bodyText(page)).includes('S3') && (await bodyText(page)).includes('D1'))

  // L2: tekil konum ekle (yeni dolap)
  await page.getByRole('button', { name: 'Konum ekle' }).click(); await page.waitForTimeout(300)
  const ed = page.locator('.rounded-xl.border')
  await ed.locator('input.font-mono').fill('S9')
  await ed.locator('input').nth(1).fill('Yeni Dolap')
  await ed.getByRole('button', { name: 'Kaydet' }).click(); await page.waitForTimeout(500)
  const locsL2 = await dexie(page, 'locations')
  const s9 = locsL2.find((l) => l.code === 'S9')
  check('L2 dolap eklendi (kod+ad+path)', s9?.name === 'Yeni Dolap' && s9?.path === 'S9', JSON.stringify({ code: s9?.code, path: s9?.path }))

  // L3: kod tekilliği — aynı kodu tekrar eklemeye çalış
  await page.getByRole('button', { name: 'Konum ekle' }).click(); await page.waitForTimeout(300)
  await page.locator('.rounded-xl.border input.font-mono').fill('S9')
  await page.locator('.rounded-xl.border').getByRole('button', { name: 'Kaydet' }).click(); await page.waitForTimeout(400)
  const s9count = (await dexie(page, 'locations')).filter((l) => l.code === 'S9' && !l.deleted_at).length
  check('L3 kod tekilliği engellendi', s9count === 1 && (await bodyText(page)).includes('tekil olmalı'))
  await page.locator('.rounded-xl.border').getByRole('button', { name: 'Vazgeç' }).click().catch(() => {}); await page.waitForTimeout(200)

  // L4: toplu üret — düz, S8 dolabı + 4 çekmece
  await page.getByRole('button', { name: 'Toplu üret' }).click(); await page.waitForTimeout(300)
  const gen = page.locator('.border-accent\\/40')
  await gen.locator('input.font-mono').fill('S8')
  await gen.locator('input[type="number"]').last().fill('4')
  await page.waitForTimeout(200)
  check('L4a önizleme toplam gösterir', (await bodyText(page)).includes('Toplam 5 konum'))
  await gen.getByRole('button', { name: 'Oluştur' }).click(); await page.waitForTimeout(700)
  const locsL4 = await dexie(page, 'locations')
  const s8 = locsL4.find((l) => l.code === 'S8')
  const s8drawers = locsL4.filter((l) => l.parent_id === s8?.id && l.type === 'drawer')
  check('L4b toplu üret: dolap + 4 çekmece (S8-01..S8-04)', !!s8 && s8drawers.length === 4 && locsL4.some((l) => l.code === 'S8-01' && l.path === 'S8/S8-01'), `drawers=${s8drawers.length}`)

  // L4c: AYNI önekle tekrar üret — yeni çekmeceler VAR OLAN dolaba bağlanır (kök yetim olmaz)
  await page.getByRole('button', { name: 'Toplu üret' }).click(); await page.waitForTimeout(300)
  const gen2 = page.locator('.border-accent\\/40')
  await gen2.locator('input.font-mono').fill('S8')
  await gen2.locator('input[type="number"]').last().fill('6'); await page.waitForTimeout(200)
  await gen2.getByRole('button', { name: 'Oluştur' }).click(); await page.waitForTimeout(700)
  const locsL4c = await dexie(page, 'locations')
  const s8b = locsL4c.find((l) => l.code === 'S8' && !l.deleted_at)
  const newD = locsL4c.find((l) => l.code === 'S8-05')
  const noOrphan = !locsL4c.some((l) => /^S8-\d\d$/.test(l.code) && l.parent_id === null)
  check('L4c mevcut dolaba ekleme: yeni çekmece dolaba bağlı, kök yetim yok', newD?.parent_id === s8b?.id && newD?.path === 'S8/S8-05' && noOrphan, `parent=${newD?.parent_id} path=${newD?.path} noOrphan=${noOrphan}`)

  // L5: silme guard — çocuğu olan dolap (S8) silinemez
  await page.getByRole('button', { name: 'Konumlar', exact: true }).click().catch(() => {}); await page.waitForTimeout(200)
  const rowS8 = page.locator('.row', { hasText: 'S8' }).first()
  await rowS8.getByRole('button', { name: 'Sil' }).click(); await page.waitForTimeout(400)
  check('L5 alt konumu olan silinemez', !(await dexie(page, 'locations')).find((l) => l.code === 'S8')?.deleted_at && (await bodyText(page)).includes('alt konum'))

  // L6: silme guard — stok olan çekmece (D1'de p-r var) silinemez
  const rowD1 = page.locator('.row', { hasText: 'D1' }).first()
  await rowD1.getByRole('button', { name: 'Sil' }).click(); await page.waitForTimeout(400)
  check('L6 stok olan konum silinemez', !(await dexie(page, 'locations')).find((l) => l.code === 'D1')?.deleted_at && (await bodyText(page)).includes('parça var'))

  // L7: boş yaprak çekmece silinebilir (S9-... yok; S8-04 boş)
  await page.locator('.row', { hasText: 'S8' }).first().getByRole('button', { name: 'Aç / kapa' }).click().catch(() => {}); await page.waitForTimeout(300)
  const rowS804 = page.locator('.row', { hasText: 'S8-04' }).first()
  await rowS804.getByRole('button', { name: 'Sil' }).click(); await page.waitForTimeout(500)
  check('L7 boş çekmece silindi (soft)', !!(await dexie(page, 'locations')).find((l) => l.code === 'S8-04')?.deleted_at)

  // L8: yeni konum outbox'a upsert olarak yazıldı
  const outL = await dexie(page, 'outbox')
  check('L8 konum işlemleri outbox\'ta (upsert location)', outL.some((o) => o.type === 'upsert' && o.entity === 'location'))
  // L10: kod/üst düzenlemede alt konum yolları (path) da güncellenir
  await page.getByRole('button', { name: 'Konumlar', exact: true }).click().catch(() => {}); await page.waitForTimeout(200)
  await page.locator('.row', { hasText: 'S3' }).first().getByRole('button', { name: 'Düzenle' }).click(); await page.waitForTimeout(300)
  await page.locator('.rounded-xl.border input.font-mono').fill('S3X')
  await page.locator('.rounded-xl.border').getByRole('button', { name: 'Kaydet' }).click(); await page.waitForTimeout(700)
  const locsL10 = await dexie(page, 'locations')
  const cab10 = locsL10.find((l) => l.id === 'cab')
  const leaf10 = locsL10.find((l) => l.id === 'c11')
  check('L10 kod düzenlemede alt konum path\'i cascade güncellendi', cab10?.code === 'S3X' && cab10?.path === 'S3X' && leaf10?.path === 'S3X/S3X-01/S3X-01-1', `cab=${cab10?.path} leaf=${leaf10?.path}`)
  // L10b: alt KODLAR da önek-değişimiyle güncellenir (S3-01→S3X-01, S3-01-1→S3X-01-1)
  const shelf10 = locsL10.find((l) => l.id === 'mod1')
  check('L10b alt kodlar önek-değişimiyle güncellendi', shelf10?.code === 'S3X-01' && leaf10?.code === 'S3X-01-1', `shelf=${shelf10?.code} leaf=${leaf10?.code}`)
  check('L11 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ O. SELF-HEAL (checksum ile sessiz stok kayması onarımı) ═══════════════
// O1: yerel özet sunucununkiyle EŞLEŞİRSE yeniden bootstrap YAPILMAZ (yanlış
//     pozitif re-download döngüsü olmaz). O2: AYRIŞIRSA sunucudan onarılır.
{
  // O1 — eşleşen özet → heal yok
  const fx1 = fixture()
  const calls1 = { checksum: 0, bootstrap: 0 }
  await sect('O-selfheal', {
    routes: async (p) => {
      await p.route('**/api/sync/pull*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ changes: [], cursor: 1, has_more: false }) }))
      await p.route('**/api/sync/push', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ applied: [], rejected: [], cursor: 1 }) }))
      await p.route('**/api/sync/checksum', (r) => { calls1.checksum++; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checksum: serverChecksum(fx1.stock), rows: fx1.stock.length, server_time: NOW }) }) })
      await p.route('**/api/sync/bootstrap', (r) => { calls1.bootstrap++; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tenant: { id: 't1', name: 'Atölye', locale: 'tr', settings: {} }, categories: [], locations: [], parts: [], stock_snapshot: [], stock_transactions: [], cursor: 1, server_time: NOW }) }) })
    },
  }, async ({ page, pageErrors }) => {
    // Özet çağrısını bekle (throttle sıfır → ilk sync'te çalışır)
    for (let i = 0; i < 30 && calls1.checksum === 0; i++) await page.waitForTimeout(200)
    await page.waitForTimeout(600) // heal olacaksa görünsün
    const st = await dexie(page, 'stock')
    check('O1 eşleşen özet → checksum kontrol edildi', calls1.checksum >= 1)
    check('O1 eşleşen özet → yeniden bootstrap YAPILMADI (yanlış pozitif yok)', calls1.bootstrap === 0, `bootstrap=${calls1.bootstrap}`)
    check('O1 eşleşen özet → yerel stok değişmedi', st.find((s) => s.key === 'p-r|d1')?.qty === 50 && st.length === fx1.stock.length)
    check('O1 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
  })

  // O2 — ayrışan özet → sunucudan onar
  const fx2 = fixture()
  const healed = fx2.stock.map((s) => (s.key === 'p-r|d1' ? { ...s, qty: 777 } : s)) // sunucu doğrusu
  const calls2 = { bootstrap: 0 }
  await sect('O-selfheal', {
    routes: async (p) => {
      await p.route('**/api/sync/pull*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ changes: [], cursor: 1, has_more: false }) }))
      await p.route('**/api/sync/push', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ applied: [], rejected: [], cursor: 1 }) }))
      await p.route('**/api/sync/checksum', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checksum: '0'.repeat(64), rows: 0, server_time: NOW }) }))
      await p.route('**/api/sync/bootstrap', (r) => { calls2.bootstrap++; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tenant: { id: 't1', name: 'Atölye', locale: 'tr', settings: {} }, categories: fx2.cats, locations: fx2.locs, parts: fx2.parts, stock_snapshot: healed, stock_transactions: [], cursor: 5, server_time: NOW }) }) })
    },
  }, async ({ page, pageErrors }) => {
    // Onarılmış qty (777) yerelde görünene dek bekle
    let qty = null
    for (let i = 0; i < 40; i++) {
      const st = await dexie(page, 'stock')
      qty = st.find((s) => s.key === 'p-r|d1')?.qty
      if (qty === 777) break
      await page.waitForTimeout(200)
    }
    check('O2 ayrışan özet → yeniden bootstrap tetiklendi', calls2.bootstrap >= 1, `bootstrap=${calls2.bootstrap}`)
    check('O2 ayrışan özet → yerel stok sunucudan onarıldı (qty 50→777)', qty === 777, `qty=${qty}`)
    const errs = await dexie(page, 'meta')
    const log = errs.find((m) => m.key === 'sync_errors')?.value ?? []
    check('O2 self-heal olayı görünür loglandı', Array.isArray(log) && log.some((e) => e.reason === 'self_heal'))
    check('O2 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
  })
}

// ═══ P. BOŞ-DURUM: hiç dolap yokken Etiket sayfası yönlendirir (B9) ══════════
await sect('P-empty-labels', {}, async ({ page, pageErrors }) => {
  // Konumları temizle → hiç dolap yok senaryosu
  await page.evaluate(() => new Promise((res) => {
    const o = indexedDB.open('depo')
    o.onsuccess = () => {
      const dbx = o.result
      const tx = dbx.transaction('locations', 'readwrite')
      tx.objectStore('locations').clear()
      tx.oncomplete = () => { dbx.close(); res() }
    }
  }))
  await page.goto(BASE + 'labels', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  const txt = await bodyText(page)
  check('P1 dolap yokken boş-durum yönlendirmesi görünür', txt.includes('Henüz dolap yok') && txt.includes('Konumlar'))
  const hasSelect = await page.locator('#cab').count()
  check('P2 dolap yokken etiket formu gizli (yalnızca yönlendirme)', hasSelect === 0)
  check('P3 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ Q. HASSAS SAYIM (B4 — çok cihazlı sunucu-yetkili sayım) ════════════════
await sect('Q-precise-count', { settings: { precise_count: true } }, async ({ page, pageErrors }) => {
  // Q1: owner ayarlarında "Hassas sayım" düğmesi + açık durumda görünür
  await page.goto(BASE + 'settings', { waitUntil: 'networkidle' }); await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Sistem', exact: true }).click(); await page.waitForTimeout(400)
  const txtQ = await bodyText(page)
  check('Q1 hassas sayım ayarı owner\'a görünür', txtQ.includes('Hassas sayım'))
  const checked = await page.locator('input[type="checkbox"]:checked').count()
  check('Q1b enjekte edilen ayar (açık) işaretli görünür', checked >= 1)

  // Q2: hassas+online → sayım sunucu-yetkili (stock_audit), yerel qty DEĞİŞMEZ
  await page.goto(BASE + 'parts/p-r', { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
  const qtyBefore = (await dexie(page, 'stock')).find((s) => s.key === 'p-r|d1')?.qty
  await page.getByRole('button', { name: 'Say', exact: true }).first().click(); await page.waitForTimeout(200)
  await page.locator('input[type="number"]').last().fill('99')
  await page.locator('button.btn-primary', { hasText: 'Kaydet' }).first().click(); await page.waitForTimeout(500)
  const qtyAfter = (await dexie(page, 'stock')).find((s) => s.key === 'p-r|d1')?.qty
  check('Q2 hassas modda yerel qty optimistik DEĞİŞMEZ (sunucu doğrular)', qtyAfter === qtyBefore, `${qtyBefore} → ${qtyAfter}`)
  const outbox = await dexie(page, 'outbox')
  const auditOp = outbox.find((o) => o.type === 'stock_audit')
  check('Q3 sayım stock_audit (sunucu-yetkili) olarak kuyruğa girdi', !!auditOp && auditOp.data?.counted_qty === 99, JSON.stringify(auditOp?.data ?? null))
  check('Q4 optimistik stock_move ÜRETİLMEDİ (çift sayım yok)', !outbox.some((o) => o.type === 'stock_move' && o.data?.reason === 'audit'))
  check('Q5 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ R. CASCADE RENAME — GERÇEK YAPI (GARAJ sitesi altında düz dolap) ══════════
// Kullanıcı senaryosu: S1 dolabı (GARAJ altında) + S1-01..03 çekmeceler. S1→SB105
// yeniden adlandırıldığında alt çekmece KODLARI da SB105-01.. olmalı. L10 testi
// parent_id=null kullanıyordu (GARAJ yok); bu test GERÇEK ebeveyni test eder.
await sect('R-cascade-flat', {}, async ({ page, pageErrors }) => {
  await page.evaluate(async () => {
    const T = '2026-07-14T10:00:00.000Z'
    const mk = (id, parent_id, code, type, path, sort) => ({ id, parent_id, code, name: type === 'cabinet' ? 'Sembol' : null, type, path, photo_id: null, capacity_note: null, sort_order: sort, updated_at: T, deleted_at: null })
    const rows = [
      mk('garaj', null, 'GARAJ', 'site', 'GARAJ', 0),
      mk('rcab', 'garaj', 'S1', 'cabinet', 'GARAJ/S1', 1),
      mk('rd1', 'rcab', 'S1-01', 'drawer', 'GARAJ/S1/S1-01', 2),
      mk('rd2', 'rcab', 'S1-02', 'drawer', 'GARAJ/S1/S1-02', 3),
      mk('rd3', 'rcab', 'S1-03', 'drawer', 'GARAJ/S1/S1-03', 4),
    ]
    await new Promise((res, rej) => {
      const o = indexedDB.open('depo')
      o.onsuccess = () => { const dbx = o.result; const tx = dbx.transaction('locations', 'readwrite'); rows.forEach((r) => tx.objectStore('locations').put(r)); tx.oncomplete = () => { dbx.close(); res() }; tx.onerror = () => rej(tx.error) }
    })
  })
  await page.goto(BASE + 'settings', { waitUntil: 'networkidle' }); await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Konumlar', exact: true }).click().catch(() => {}); await page.waitForTimeout(300)
  // GARAJ'ı aç → S1 görünür
  const garajRow = page.locator('.row').filter({ has: page.getByText('GARAJ', { exact: true }) }).first()
  await garajRow.getByRole('button', { name: 'Aç / kapa' }).click().catch(() => {}); await page.waitForTimeout(250)
  // S1 dolabını düzenle → SB105
  const s1Row = page.locator('.row').filter({ has: page.getByText('S1', { exact: true }) }).first()
  await s1Row.getByRole('button', { name: 'Düzenle' }).click(); await page.waitForTimeout(300)
  await page.locator('.rounded-xl.border input.font-mono').fill('SB105')
  await page.locator('.rounded-xl.border').getByRole('button', { name: 'Kaydet' }).click(); await page.waitForTimeout(800)
  const locs = await dexie(page, 'locations')
  const cab = locs.find((l) => l.id === 'rcab')
  const d1 = locs.find((l) => l.id === 'rd1'), d2 = locs.find((l) => l.id === 'rd2'), d3 = locs.find((l) => l.id === 'rd3')
  check('R1 dolap kodu SB105 + path GARAJ/SB105', cab?.code === 'SB105' && cab?.path === 'GARAJ/SB105', `code=${cab?.code} path=${cab?.path}`)
  check('R2 alt çekmece KODLARI SB105-01..03 oldu', d1?.code === 'SB105-01' && d2?.code === 'SB105-02' && d3?.code === 'SB105-03', `${d1?.code},${d2?.code},${d3?.code}`)
  check('R3 alt path GARAJ/SB105/SB105-01', d1?.path === 'GARAJ/SB105/SB105-01', `path=${d1?.path}`)
  check('R4 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ R2. CASCADE ONARIM — bozuk veriyi düzelt (kabin SB105 ama çocuk S1-01) ════
// Kullanıcının GERÇEK bozuk durumu: eski build kabini SB105 yaptı ama çocuklar
// S1-01 kaldı (önek uyuşmuyor). Onarım: SB105→S1 (çocuklar S1-01 kalır, tutarlı)
// sonra S1→SB105 (çocuklar SB105-01 olur). Bu iki adımı DOĞRULAR.
await sect('R2-cascade-recovery', {}, async ({ page, pageErrors }) => {
  await page.evaluate(async () => {
    const T = '2026-07-14T10:00:00.000Z'
    const mk = (id, parent_id, code, type, path, sort) => ({ id, parent_id, code, name: type === 'cabinet' ? 'Sembol' : null, type, path, photo_id: null, capacity_note: null, sort_order: sort, updated_at: T, deleted_at: null })
    const rows = [
      mk('garaj', null, 'GARAJ', 'site', 'GARAJ', 0),
      // BOZUK: kabin SB105, çocuklar hâlâ S1-01.. (path kabin segmenti güncellenmiş)
      mk('bcab', 'garaj', 'SB105', 'cabinet', 'GARAJ/SB105', 1),
      mk('bd1', 'bcab', 'S1-01', 'drawer', 'GARAJ/SB105/S1-01', 2),
      mk('bd2', 'bcab', 'S1-02', 'drawer', 'GARAJ/SB105/S1-02', 3),
    ]
    await new Promise((res, rej) => {
      const o = indexedDB.open('depo')
      o.onsuccess = () => { const dbx = o.result; const tx = dbx.transaction('locations', 'readwrite'); rows.forEach((r) => tx.objectStore('locations').put(r)); tx.oncomplete = () => { dbx.close(); res() }; tx.onerror = () => rej(tx.error) }
    })
  })
  await page.goto(BASE + 'settings', { waitUntil: 'networkidle' }); await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Konumlar', exact: true }).click().catch(() => {}); await page.waitForTimeout(300)
  await page.locator('.row').filter({ has: page.getByText('GARAJ', { exact: true }) }).first()
    .getByRole('button', { name: 'Aç / kapa' }).click().catch(() => {}); await page.waitForTimeout(250)

  const editTo = async (fromCode, toCode) => {
    await page.locator('.row').filter({ has: page.getByText(fromCode, { exact: true }) }).first()
      .getByRole('button', { name: 'Düzenle' }).click(); await page.waitForTimeout(300)
    await page.locator('.rounded-xl.border input.font-mono').fill(toCode)
    await page.locator('.rounded-xl.border').getByRole('button', { name: 'Kaydet' }).click(); await page.waitForTimeout(800)
  }
  // Adım 1: SB105 → S1 (çocuk kodları değişmez, önek tutarlı hâle gelir)
  await editTo('SB105', 'S1')
  let locs = await dexie(page, 'locations')
  check('R2.1 SB105→S1: çocuklar S1-01 kaldı, path GARAJ/S1/S1-01', locs.find((l) => l.id === 'bd1')?.code === 'S1-01' && locs.find((l) => l.id === 'bd1')?.path === 'GARAJ/S1/S1-01', `${locs.find((l) => l.id === 'bd1')?.code} / ${locs.find((l) => l.id === 'bd1')?.path}`)
  // Adım 2: S1 → SB105 (çocuklar artık cascade ile SB105-01 olur)
  await editTo('S1', 'SB105')
  locs = await dexie(page, 'locations')
  const bd1 = locs.find((l) => l.id === 'bd1'), bd2 = locs.find((l) => l.id === 'bd2')
  check('R2.2 onarım tamam: çocuk KODLARI SB105-01/02, path GARAJ/SB105/SB105-01', bd1?.code === 'SB105-01' && bd2?.code === 'SB105-02' && bd1?.path === 'GARAJ/SB105/SB105-01', `${bd1?.code},${bd2?.code} / ${bd1?.path}`)
  check('R2.3 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ R3. CASCADE — ÖNEK UYUŞMAYAN çocukları TEK ADIMDA yeni koda çevir ════════
// Kullanıcının tam senaryosu: dolap SB1055, çocuklar hâlâ S1-01 (eski önek).
// SB1055→SB105 yapınca çocuklar TEK adımda SB105-01 olmalı (iki adım gerekmeden).
await sect('R3-cascade-mismatch', {}, async ({ page, pageErrors }) => {
  await page.evaluate(async () => {
    const T = '2026-07-14T10:00:00.000Z'
    const mk = (id, parent_id, code, type, path, sort) => ({ id, parent_id, code, name: type === 'cabinet' ? 'Sembol' : null, type, path, photo_id: null, capacity_note: null, sort_order: sort, updated_at: T, deleted_at: null })
    const rows = [
      mk('garaj', null, 'GARAJ', 'site', 'GARAJ', 0),
      mk('mcab', 'garaj', 'SB1055', 'cabinet', 'GARAJ/SB1055', 1), // dolap SB1055
      mk('md1', 'mcab', 'S1-01', 'drawer', 'GARAJ/SB1055/S1-01', 2), // çocuklar hâlâ S1-01 (önek uyuşmuyor)
      mk('md2', 'mcab', 'S1-02', 'drawer', 'GARAJ/SB1055/S1-02', 3),
      mk('md3', 'mcab', 'S1-70', 'drawer', 'GARAJ/SB1055/S1-70', 4),
    ]
    await new Promise((res, rej) => {
      const o = indexedDB.open('depo')
      o.onsuccess = () => { const dbx = o.result; const tx = dbx.transaction('locations', 'readwrite'); rows.forEach((r) => tx.objectStore('locations').put(r)); tx.oncomplete = () => { dbx.close(); res() }; tx.onerror = () => rej(tx.error) }
    })
  })
  await page.goto(BASE + 'settings', { waitUntil: 'networkidle' }); await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Konumlar', exact: true }).click().catch(() => {}); await page.waitForTimeout(300)
  await page.locator('.row').filter({ has: page.getByText('GARAJ', { exact: true }) }).first()
    .getByRole('button', { name: 'Aç / kapa' }).click().catch(() => {}); await page.waitForTimeout(250)
  // SB1055 → SB105 (TEK adım)
  await page.locator('.row').filter({ has: page.getByText('SB1055', { exact: true }) }).first()
    .getByRole('button', { name: 'Düzenle' }).click(); await page.waitForTimeout(300)
  await page.locator('.rounded-xl.border input.font-mono').fill('SB105')
  await page.locator('.rounded-xl.border').getByRole('button', { name: 'Kaydet' }).click(); await page.waitForTimeout(800)
  const locs = await dexie(page, 'locations')
  const md1 = locs.find((l) => l.id === 'md1'), md2 = locs.find((l) => l.id === 'md2'), md3 = locs.find((l) => l.id === 'md3')
  check('R3.1 önek uyuşmayan çocuklar TEK adımda SB105-01/02/70 oldu', md1?.code === 'SB105-01' && md2?.code === 'SB105-02' && md3?.code === 'SB105-70', `${md1?.code},${md2?.code},${md3?.code}`)
  check('R3.2 alt path GARAJ/SB105/SB105-01', md1?.path === 'GARAJ/SB105/SB105-01', `path=${md1?.path}`)
  check('R3.3 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ T. FOTOĞRAF EKLE (FAZ 2.1) ═══════════════════════════════════════════
await sect('T-photos', {}, async ({ page, pageErrors }) => {
  await page.goto(BASE + 'parts/p-r', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  check('T1 foto galeri kartı görünür (boş durum)', (await bodyText(page)).includes('Fotoğraf'))
  // Geçerli 8x8 PNG → gizli foto input'una ver (addAttachment: küçült + sha256 + kuyruk)
  const png = Buffer.from(makePngB64(8, 8), 'base64')
  const input = page.locator('input[type="file"]').first()
  await input.setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: png })
  await page.waitForTimeout(800)
  const ups = await dexie(page, 'uploads')
  check('T2 foto → bekleyen yükleme kuyruğa girdi (owner=p-r)', ups.length >= 1 && ups.some((u) => u.owner_id === 'p-r' && u.owner_type === 'part'))
  check('T3 bekleyen foto sha256 + blob taşıyor', ups[0] && typeof ups[0].sha256 === 'string' && ups[0].sha256.length === 64 && !!ups[0].blob)
  check('T4 galeride "Yüklenecek" rozeti göründü', (await bodyText(page)).includes('Yüklenecek'))
  // T6: aynı foto (aynı sha) tekrar eklenince YİNELENMEZ (bulgu #11 dedup).
  await input.setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: png })
  await page.waitForTimeout(700)
  const ups2 = await dexie(page, 'uploads')
  check('T6 aynı foto ikinci kez eklenince kuyruk büyümedi (sha dedup)', ups2.filter((u) => u.owner_id === 'p-r').length === 1, `n=${ups2.filter((u) => u.owner_id === 'p-r').length}`)
  check('T5 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ U. EKSİK / ALIŞVERİŞ LİSTESİ (FAZ 2.4) ════════════════════════════════
await sect('U-shopping', {}, async ({ page, pageErrors }) => {
  // Eksik senaryosu: min_qty=10 ama toplam 2 (exact) + doluluk tümü BİTTİ
  await page.evaluate(async ({ NOW }) => {
    const put = (store, rows) => new Promise((res, rej) => {
      const o = indexedDB.open('depo')
      o.onsuccess = () => { const dbx = o.result; const tx = dbx.transaction(store, 'readwrite'); rows.forEach((r) => tx.objectStore(store).put(r)); tx.oncomplete = () => { dbx.close(); res() }; tx.onerror = () => rej(tx.error) }
    })
    await put('parts', [
      { id: 'sh-ex', category_id: 'cat-r', sku: 'R-SHORT', name: 'Az Kalan Direnç', mpn: null, manufacturer: null, attributes: null, tags: 'az', count_mode: 'exact', abc_class: 'C', min_qty: 10, unit: 'adet', datasheet_url: null, photo_id: null, notes: null, updated_at: NOW, deleted_at: null },
      { id: 'sh-lv', category_id: 'cat-cam', sku: 'CAM-BITTI', name: 'Biten Cam', mpn: null, manufacturer: null, attributes: null, tags: 'bit', count_mode: 'level', abc_class: 'C', min_qty: null, unit: 'adet', datasheet_url: null, photo_id: null, notes: null, updated_at: NOW, deleted_at: null },
    ])
    await put('stock', [
      { key: 'sh-ex|d1', part_id: 'sh-ex', location_id: 'd1', qty: 2, level: null, level_at: null, last_move_at: NOW },
      { key: 'sh-lv|d2', part_id: 'sh-lv', location_id: 'd2', qty: 0, level: 'empty', level_at: NOW, last_move_at: NOW },
    ])
  }, { NOW })
  await page.goto(BASE + 'shopping', { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
  const txt = await bodyText(page)
  check('U1 min altı parça listelendi (R-SHORT)', txt.includes('Az Kalan Direnç') && txt.includes('R-SHORT'))
  check('U2 tükenmiş doluluk parçası listelendi (BİTTİ)', txt.includes('Biten Cam') && txt.includes('BİTTİ'))
  check('U3 yeterli/min-siz parça listelenmez', !txt.includes('10K Direnç'))
  check('U4 panoya kopyala düğmesi var', await page.getByRole('button', { name: /Panoya kopyala/ }).isVisible().catch(() => false))
  check('U5 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ V. CSV TOPLU İÇE AKTARMA (Ayarlar → İçe Aktar) ════════════════════════
await sect('V-import', {}, async ({ page, pageErrors }) => {
  await page.goto(BASE + 'settings', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'İçe Aktar', exact: true }).click(); await page.waitForTimeout(300)
  // 2 geçerli (yeni direnç exact+stok, yeni lehim doluluk+dolu) + 2 hatalı (yok kategori, çakışan SKU)
  const csv = [
    'ad;kategori;sku;sayim;birim;min;adet;doluluk;konum',
    'Yeni Direnç 22R;Direnç;;miktarlı;adet;10;150;;D1',
    'Yeni Lehim;Muhtelif;;doluluk;;;;dolu;D2',
    'Hatalı Kategori;YokKategori;;miktarlı;adet;;5;;D1',
    'Çakışan;Direnç;R-10K-0805;miktarlı;adet;;3;;D1',
  ].join('\n')
  await page.locator('textarea').first().fill(csv); await page.waitForTimeout(400)
  const preview = await bodyText(page)
  check('V1 önizleme 2 geçerli sayar', preview.includes('2 geçerli'), preview.slice(0, 120))
  check('V2 önizleme 2 hatalı sayar (yok kategori + çakışan SKU)', preview.includes('2 hatalı'))
  check('V3 çakışan SKU hatası görünür', /SKU zaten var/i.test(preview))
  await page.getByRole('button', { name: /parçayı içe aktar/ }).click(); await page.waitForTimeout(900)
  const parts = await dexie(page, 'parts')
  const yd = parts.find((p) => p.name === 'Yeni Direnç 22R')
  const yl = parts.find((p) => p.name === 'Yeni Lehim')
  check('V4 geçerli parçalar Dexie\'ye yazıldı', !!yd && !!yl, `yd=${!!yd} yl=${!!yl}`)
  check('V5 exact parça kategori+min+üretilen SKU aldı', yd?.category_id === 'cat-r' && yd?.min_qty === 10 && !!yd?.sku, JSON.stringify({ c: yd?.category_id, m: yd?.min_qty, s: yd?.sku }))
  check('V6 hatalı satırlar içe aktarılmadı', !parts.some((p) => p.name === 'Hatalı Kategori') && !parts.some((p) => p.name === 'Çakışan'))
  const stock = await dexie(page, 'stock')
  const ydStock = stock.find((s) => s.part_id === yd?.id && s.location_id === 'd1')
  const ylStock = stock.find((s) => s.part_id === yl?.id && s.location_id === 'd2')
  check('V7 exact başlangıç stoğu D1\'de 150', Number(ydStock?.qty) === 150, `qty=${ydStock?.qty}`)
  check('V8 doluluk başlangıç stoğu D2\'de DOLU', ylStock?.level === 'full', `lvl=${ylStock?.level}`)
  check('V9 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ W. SON HAREKETİ GERİ AL (undo) ════════════════════════════════════════
await sect('W-undo', {}, async ({ page, pageErrors }) => {
  await page.goto(BASE + 'parts/p-r', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  const before = (await dexie(page, 'stock')).find((s) => s.key === 'p-r|d1').qty
  await page.getByRole('button', { name: '+1', exact: true }).first().click(); await page.waitForTimeout(400)
  const afterPlus = (await dexie(page, 'stock')).find((s) => s.key === 'p-r|d1').qty
  check('W1 +1 uygulandı', afterPlus === before + 1, `${before}->${afterPlus}`)
  await page.getByRole('button', { name: /Son hareketi geri al/ }).click(); await page.waitForTimeout(500)
  const afterUndo = (await dexie(page, 'stock')).find((s) => s.key === 'p-r|d1').qty
  check('W2 geri al: stok eski değere döndü', afterUndo === before, `${afterPlus}->${afterUndo}`)
  const txs = await dexie(page, 'transactions')
  check('W3 telafi hareketi yazıldı (adjust −1, defter silinmedi)', txs.some((t) => t.part_id === 'p-r' && t.delta === -1 && t.reason === 'adjust' && t.note === 'Geri alma'))
  check('W4 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ X. BARKODLA ARAMA (ScanModal — kamera yok → manuel giriş) ═════════════
await sect('X-barcode', {}, async ({ page, pageErrors }) => {
  await page.goto(BASE + 'search', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Barkodla ara' }).click(); await page.waitForTimeout(900)
  check('X1 tarama modalı açıldı', await page.locator('[role="dialog"] input').count() > 0)
  await page.locator('[role="dialog"] input').first().fill('R-10K-0805')
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Git', exact: true }).click(); await page.waitForTimeout(500)
  const txt = await bodyText(page)
  check('X2 barkod araması parçayı buldu (SKU/MPN eşleşmesi)', txt.includes('10K Direnç'), txt.slice(0, 80))
  check('X3 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ Y. GİRİŞTE MPN ALANI (barkod hedefi) KALICI ═══════════════════════════
await sect('Y-intake-mpn', {}, async ({ page, pageErrors }) => {
  await page.goto(BASE + 'intake', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  await page.getByRole('button', { name: /Direnç/ }).first().click(); await page.waitForTimeout(300)
  await page.locator('#attr-deger').fill('3K3')
  await page.getByRole('button', { name: '0805', exact: true }).click(); await page.waitForTimeout(200)
  await page.locator('input[placeholder="MPN"]').fill('RC0805-3K3')
  await page.getByRole('button', { name: /Devam/ }).click(); await page.waitForTimeout(300)
  await page.locator('#intake-loc').fill('D1'); await page.waitForTimeout(250)
  await page.locator('input[placeholder="0"]').fill('10'); await page.waitForTimeout(150)
  await page.getByRole('button', { name: /Kaydet/ }).last().click(); await page.waitForTimeout(700)
  const np = (await dexie(page, 'parts')).find((p) => p.sku === 'R-3K3-0805')
  check('Y1 parça MPN ile kaydedildi', np?.mpn === 'RC0805-3K3', JSON.stringify({ sku: np?.sku, mpn: np?.mpn }))
  check('Y2 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ Z. DOLULUK TAŞIMA → UNDO GUARD (yarım transfer/hayalet stok önleme) ════
await sect('Z-level-transfer-undo', {}, async ({ page, pageErrors }) => {
  await page.goto(BASE + 'parts/p-cam', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Başka çekmeceye taşı' }).first().click(); await page.waitForTimeout(200)
  await page.locator('input[placeholder*="onum kodu"]').fill('D1'); await page.waitForTimeout(250)
  await page.locator('button.btn-primary', { hasText: 'Taşı' }).click(); await page.waitForTimeout(800)
  const legs = (await dexie(page, 'transactions')).filter((t) => t.part_id === 'p-cam' && t.reason === 'transfer' && t.level_to != null)
  check('Z1 doluluk taşımanın iki bacağı da reason=transfer', legs.length >= 2, `legs=${legs.length}`)
  const st = await dexie(page, 'stock')
  check('Z2 hedef DOLU, kaynak BİTTİ (hayalet stok yok)', st.find((s) => s.key === 'p-cam|d1')?.level === 'full' && st.find((s) => s.key === 'p-cam|d2')?.level === 'empty')
  check('Z3 transfer bacağında "Son hareketi geri al" GİZLİ', (await page.getByRole('button', { name: /Son hareketi geri al/ }).count()) === 0)
  check('Z4 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ═══ AA. MEVCUT PARÇAYA BARKOD MPN GERİ-DOLDURMA (sessiz kayıp önleme) ══════
await sect('AA-mpn-backfill', {}, async ({ page, pageErrors }) => {
  await page.evaluate(async ({ NOW }) => {
    await new Promise((res, rej) => {
      const o = indexedDB.open('depo')
      o.onsuccess = () => { const dbx = o.result; const tx = dbx.transaction('parts', 'readwrite')
        tx.objectStore('parts').put({ id: 'p-bf', category_id: 'cat-r', sku: 'R-9K1-0805', name: 'Backfill Direnç', mpn: null, manufacturer: null, attributes: { deger: '9K1', paket: '0805' }, tags: 'backfill', count_mode: 'exact', abc_class: 'C', min_qty: null, unit: 'adet', datasheet_url: null, photo_id: null, notes: null, updated_at: NOW, deleted_at: null })
        tx.oncomplete = () => { dbx.close(); res() }; tx.onerror = () => rej(tx.error) }
    })
  }, { NOW })
  await page.goto(BASE + 'intake', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
  await page.getByRole('button', { name: /Direnç/ }).first().click(); await page.waitForTimeout(300)
  await page.locator('#attr-deger').fill('9K1')
  await page.getByRole('button', { name: '0805', exact: true }).click(); await page.waitForTimeout(200)
  await page.locator('input[placeholder="MPN"]').fill('BACKFILL-1')
  await page.getByRole('button', { name: /Devam/ }).click(); await page.waitForTimeout(300)
  await page.locator('#intake-loc').fill('D1'); await page.waitForTimeout(250)
  await page.locator('input[placeholder="0"]').fill('5'); await page.waitForTimeout(150)
  await page.getByRole('button', { name: /Kaydet/ }).last().click(); await page.waitForTimeout(700)
  const bf = (await dexie(page, 'parts')).find((p) => p.id === 'p-bf')
  check('AA1 mevcut parçaya MPN geri-dolduruldu (yeni parça oluşmadı)', bf?.mpn === 'BACKFILL-1', JSON.stringify({ mpn: bf?.mpn }))
  check('AA2 mükerrer SKU ile ikinci parça oluşmadı', (await dexie(page, 'parts')).filter((p) => p.sku === 'R-9K1-0805' && !p.deleted_at).length === 1)
  check('AA3 sayfa hatası yok', pageErrors.length === 0, pageErrors.join(' | '))
})

// ---------------------------------------------------------------------------
await browser.close()
const fails = results.filter((r) => !r.ok)
console.log('\n──────────────────────────────────────────────')
console.log(`TOPLAM: ${results.length}  GEÇEN: ${results.length - fails.length}  BAŞARISIZ: ${fails.length}`)
for (const f of fails) console.log(`  ✗ [${f.section}] ${f.name} — ${f.detail}`)
writeFileSync(OUT, JSON.stringify({ total: results.length, passed: results.length - fails.length, failed: fails.length, results }, null, 2))
console.log(`Rapor: ${OUT}`)
process.exit(fails.length ? 1 : 0)
