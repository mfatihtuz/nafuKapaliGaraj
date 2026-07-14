# DEPO — Aksiyon Raporu (Action Report)

**Tarih:** 14 Temmuz 2026 · Denetim raporunun (`docs/AUDIT_REPORT.md`) eşlikçisi: **ne yapıldı, ne yapılmadı ama yapılabilir.**

---

## A. BU TURDA YAPILANLAR (aksiyon alındı ✅)

### Kalıcı test güvencesi
- **`web/e2e/audit.mjs`** — 90 kontrollük tarayıcı E2E paketi depoya eklendi. Backend gerektirmez; `npm run build && npm run preview` sonra `node e2e/audit.mjs`. Her bölüm izole çalışır, sonuç JSON raporu üretir. **Bundan sonra her değişiklik bu matristen geçirilebilir.**

### Düzeltmeler (34 kalem — ayrıntı ve gerekçeler denetim raporunda §3)
Özet dağılım:

| Alan | Düzeltme |
|---|---|
| Güvenlik / izolasyon | Hesap değişiminde yerel veri silme · parola değişince diğer oturumların iptali · boş e-posta kilidi · defter geri-okumasında tenant filtresi |
| Senkronizasyon | Push serileştirme (GET_LOCK) · bekleyen-upsert'li "not_found" reddinin geçici sayılması · 500'lük dilimleme · sayımda kilitli okuma · sayısal delta doğrulaması · transfer `ref_id` eşlemesi |
| Veri bütünlüğü | Miktar > 0 zorunluluğu · −N sınırı · sayım yöntemi çakışması engeli · kategori döngü/tekillik/yetim korumaları · takipsiz varlık modeli |
| Kullanılabilirlik | Görünmez Düzenle düğmesi · Vazgeç · senkron hata rozeti · çıkışta bekleyen-işlem onayı · grup konumda alt-konum listesi · etiket baskı bölünmesi · mobil taşma · erişilebilir adlar · "Dil" başlığı |
| Sağlamlık | JSON olmayan yanıt hatası · bozuk UTF-8 kodlama onarımı · health `ok` düzeltmesi |

Commit'ler: `test(e2e): 86 kontrollük paket + 2 düzeltme`, `fix: kapsamlı denetim düzeltmeleri`, ve bu raporla gelen son commit.

---

## B. AKSİYON ALINMADI — YAPILABİLECEKLER (önceliklendirilmiş backlog 📋)

### Öncelik 1 — Günlük kullanımda hissedilecek eksikler

1. **Konum (çekmece/dolap) yönetim ekranı YOK.** Konumlar yalnızca kurulum SQL'inden geliyor; uygulamadan yeni çekmece eklemek, ad değiştirmek, silmek mümkün değil. `saveLocation` altyapısı hazır, UI yazılmadı. *(Öneri: Ayarlar > Konumlar — ağaç + tip + toplu çekmece üretici "S4 dolabı, 3×6 göz" gibi.)*
2. **Sayım (audit) ekranı YOK.** Mutlak miktar düzeltme ("bu gözde 7 tane varmış") altyapısı (`auditStock`) hazır ama hiçbir ekrana bağlı değil; kullanıcı şimdilik −N/+1 ile düzeltiyor. *(SPRINT_PLAN 4.1'in öne çekilmiş küçük hali yapılabilir.)*
3. **Parça düzenleme dar:** öznitelikler, kategori, üretici/MPN, not ve veri sayfası (datasheet) hiçbir ekrandan düzenlenemiyor; yalnızca ad/yöntem/birim/kritik stok. 
4. **Kullanıcı formu istemci doğrulaması:** kullanıcı adı VEYA e-posta zorunluluğu yalnızca sunucuda; formda erken uyarı yok. Üye için parola sıfırlama (owner eliyle) yok.

### Öncelik 2 — Sağlamlaştırma (senkron/güvenlik)

5. **Checksum / self-heal ucu yok** (SPRINT_PLAN 4.3): kalıcı reddedilen katalog işlemleri ve geri alınamayan doluluk hareketleri "bir sonraki bootstrap"a güveniyor ama bootstrap bayrağı hiç sıfırlanmıyor. *(Öneri: `GET /api/sync/checksum` + uyuşmazlıkta otomatik yeniden bootstrap.)*
6. **Oturum token'ları veritabanında düz metin.** *(Öneri: SHA-256 hash'le sakla.)*
7. **Push/pull/bootstrap için hız sınırı yok** (yalnızca login'de var).
8. **Geçici hatalarda üstel bekleme (backoff) yok** — 8 deneme hızla tükenebilir.
9. **Katalog referans alanları** (`category_id`, `parent_id`, `ref_id`…) tenant-aidiyet doğrulamasından geçmiyor (izolasyonu bozmuyor ama çöp referansa izin veriyor).
10. **Doluluk (level) LWW eşitliğinde belirleyici (tiebreaker) yok** — aynı milisaniyede iki cihaz kalıcı farklı görebilir.
11. **Atomik transfer op'u:** taşıma hâlâ iki ayrı harekettir; sunucu tarafı tek "transfer" op tipi kısmi-red riskini sıfırlar.
12. `sessions` / `login_attempts` tabloları budanmıyor (sınırsız büyüme). `Db::transaction` iç içe çağrı tuzağı. `updateSettings` şema doğrulaması. Unique yarışlarında 409 yerine 500.

### Öncelik 3 — Çok dillilik & cila

13. **Sabit metin kalıntıları:** `format.ts` (DOLU/AZ/BİTTİ, hareket adları, "az önce/dk/sa"), `units.ts` (adet/metre/…), kategori editörü placeholder'ları. Kod çok dilliliğe hazır ama bu sabitler taşınmadı; `en.json` boş (FAZ 1 planına uygun, ürünleştirmede dolacak).
14. Etiket sayfasında dolap yokken yönlendirici boş-durum metni.
15. `index.php` config-yok durumunda `exit` kullanıyor (kural istisnası, autoloader öncesi — dokümante edildi).

### Sıradaki tur (senin yeni taleplerin — şimdi başlıyor 🚧)

16. **Malzeme ekle/sil/taşı akışlarının UI/UX yeniden tasarımı** — tüm sayfalarda tasarım kötülüğü taraması (senior UI/UX bakışı).
17. **Etiket tipi ↔ dolap ilişkisi** — dolap seçince o dolabın etiket tipi otomatik gelsin; tip güncellenince bağlı ekranlar yansısın.
18. **Aramada çekmece/konum filtresi** + grup ve alt-grupların görsel olarak belirginleştirilmesi.

---

## C. Dağıtım

1. `depo_yonetimi_deploy.zip` → Hostinger File Manager → `public_html/depo_yonetimi/` üzerine çıkar (config.php pakette korunur).
2. Tarayıcıda `Ctrl+Shift+R`.
3. Veritabanı değişikliği YOK (bu turda şema aynı kaldı).

**Test durumu:** E2E 90/90 · PHP 63/63 · tsc/build temiz.
