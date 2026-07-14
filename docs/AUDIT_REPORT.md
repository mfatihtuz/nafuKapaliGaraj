# DEPO — Kapsamlı Denetim Raporu (Full Audit Report)

**Tarih:** 14 Temmuz 2026 · **Kapsam:** Tüm ekleme / çıkarma / güncelleme / taşıma akışları, senkronizasyon, çok kullanıcılılık, offline davranış, güvenlik, mobil uyum.

---

## 1. Denetim Yöntemi

Üç bağımsız katman kullanıldı:

| Katman | Ne yapar | Sonuç |
|---|---|---|
| **Tarayıcı E2E paketi** (`web/e2e/audit.mjs`) | Gerçek Chromium'da 11 bölüm, **90 kontrol**: her CRUD akışı tıklanarak uçtan uca sürülür, sonuç IndexedDB'den doğrulanır | **90/90 GEÇTİ** |
| **PHP backend testleri** (`api/tests/`) | Senkronizasyon protokolü (41) + HTTP/auth/kilitleme (22) | **63/63 GEÇTİ** |
| **Statik kod denetimi** (7 boyutlu, çapraz doğrulamalı) | CRUD bütünlüğü, sync yarış durumları, tenant güvenliği, offline dayanıklılık, veri modeli, UI boşlukları, backend sağlamlığı — **71 ham bulgu**, her biri kod üzerinde tek tek doğrulandı | Doğrulananlar düzeltildi (bkz. §3), kalanlar Aksiyon Raporu'nda |

E2E paketi artık depoda kalıcı — her değişiklikten sonra `node e2e/audit.mjs` ile tüm matris yeniden koşulabilir. **Bu, "test ettikçe hata bulma" döngüsünün önüne geçen kalıcı güvencedir.**

---

## 2. Test Matrisi — Neler Sürüldü?

| Bölüm | Kapsam | Kontrol |
|---|---|---|
| **A — Parça Ekle** | 3 adımlı sihirbaz; Miktarlı/Doluluk/Takipsiz modlar; enum seçimi; kod (SKU) önizleme; mükerrer kod → mevcut parçaya ekleme; seri giriş; yaprak-konum kuralı; geçersiz/grup konum reddi; boş miktar engeli | 18 |
| **B — Parça Detay** | Ad düzenleme; +1/−1/−N; −N sınırı; taşıma (çekmece→çekmece, dolap reddi, takipsiz taşıma); doluluk değişimi; sayım yöntemi değişimi; yöntem çakışması engeli; arşivleme; defterin (ledger) korunumu | 19 |
| **C — Konum Ekranı** | Parça listesi; arşivli gizli; takipsiz çip; stok işlemi; "Buraya parça ekle" ön-dolgu; bilinmeyen kod; tükenmiş satır gizleme; doluluk görünürlüğü | 9 |
| **D — Arama** | Boş sorgu = tüm envanter; Türkçe-duyarsız eşleşme ("direnc"→"Direnç"); üst kategori alt kategorileri kapsar; karantina varsayılan gizli/kutu ile açılır; arşivli gizli | 8 |
| **E — Kategoriler** | Kök + alt kategori ekleme; kod sanitizasyonu ("yap 15"→"YAP15"); düzenleme; yaprak silme; **alt kategorili silme engeli**; dinamik kod şablonu; enum yazım regresyonu | 8 |
| **F — Etiketler** | Varsayılan 6 tip; A4'ten türetilen ızgara; canlı yeniden hesap; yazdırma sayfası tip seçici; QR üretimi (4 çekmece) | 6 |
| **G — Misafir (viewer)** | Menüde Ekle yok; intake URL kilidi; düzenle/taşı/arşiv yok; stok salt-okunur; owner bölümleri gizli; kategoriler salt-okunur | 8 |
| **H — Tara** | Manuel kod (küçük harf dahil) → konum; bilinmeyen rota → Tara | 3 |
| **I — Offline** | API tamamen kapalıyken stok işlemi yerelde çalışır; işlemler outbox'ta bekler (geri alınmaz); rozet durumu gösterir; çökme yok | 4 |
| **J — Mobil (375px)** | Alt navigasyon; yatay taşma yok (arama + parça detay); dokunma hedefi ≥ 40px | 5 |
| **K — Kullanıcılar** | Ekip listesi; kullanıcı ekleme formu + rol seçenekleri | 3 |

---

## 3. Bulunan ve DÜZELTİLEN Hatalar

### Kritik / Yüksek

1. **Giriş yapan hesap değişince önceki hesabın verisi cihazda kalıyordu** *(tenant izolasyon ihlali)*
   Oturum düştükten sonra FARKLI bir kullanıcı girerse, önceki organizasyonun tüm envanteri IndexedDB'de duruyordu. → Artık farklı kullanıcı/organizasyon girişinde yerel veri tamamen silinir.

2. **Çıkış (logout) gönderilmemiş işlemleri sessizce siliyordu** *(veri kaybı)*
   Offline'da yapılan stok hareketleri push edilmeden çıkılırsa kayboluyordu. → Çıkışta önce eşitleme denenir; hâlâ bekleyen varsa sayısıyla birlikte onay sorulur.

3. **Eşzamanlı iki cihaz push'unda değişiklik atlanabiliyordu** *(kalıcı senkron sapması)*
   `change_log` sırası ile commit sırası ayrışınca, araya giren bir çekme (pull) işlemi imleci ileri taşıyıp henüz commit edilmemiş satırı SONSUZA DEK atlıyordu. → Push'lar artık organizasyon-bazlı kilitle (GET_LOCK) serileştiriliyor; paylaşımlı hostingde çalışır.

4. **Geçici bir sunucu hatası, yeni parçanın açılış stoğunu kalıcı kaybettirebiliyordu**
   Parça kaydı geçici hata alırsa, ona bağlı stok hareketi "parça yok" diye kalıcı reddedilip geri alınıyordu; parça sonra oluşunca stok 0 kalıyordu. → Bekleyen parça kaydı varken "bulunamadı" reddi geçici sayılır, hareket kuyrukta bekler.

5. **Parça detayındaki Düzenle düğmesi görünmezdi** *(beyaz zeminde beyaz ikon)*
   Kullanıcının "düzenleme yok sanma" şikayetlerinin muhtemel kökü. → Koyu renk + erişilebilir ad eklendi.

6. **Alt kategorisi olan kategori silinince çocuklar "yetim" kalıp ağaçtan kayboluyordu** → Silme engellenir, açıklayıcı uyarı gösterilir.

7. **Takipsiz parça taşınınca eski konumda da görünmeye devam ediyordu** → Varlık modeli düzeltildi: taşıma kaynağı temizler, hedefe işaret koyar.

### Orta

8. **Boş/0 miktarla parça eklenebiliyordu** — parça 0 stokla oluşup "tükenmiş" sayılınca listelerden gizleniyor, kullanıcı "parça kayboldu" sanıyordu (daha önce yaşadığın "adet 0" sorununun kökü). → Miktarlı modda miktar > 0 zorunlu.
9. **−N ile eldekinden fazlası düşülebiliyordu** — stok sessizce eksiye iniyordu. → Eldekiyle sınırlandı; −1 düğmesi sıfırda pasif.
10. **Eşzamanlı iki sayım (audit) düzeltmeyi çift uyguluyordu** (10→7 sayımı iki cihazdan gelirse sonuç 4 oluyordu). → Kilitli okuma (FOR UPDATE).
11. **Parola değişince diğer cihazlardaki oturumlar açık kalıyordu** (90 güne kadar). → Diğer oturumlar anında kapatılır.
12. **E-posta profilden boşaltılınca hesap kilitlenebiliyordu** → Boş e-posta yazılmaz; kullanıcı adı yoksa engellenir.
13. **Senkron hatası "Güncel" rozetiyle maskeleniyordu** → Hata artık rozette görünür.
14. **Kuyruk 1000 işlemi aşarsa push sonsuza dek 400 alıyordu** → 500'lük dilimleme.
15. **Aynı transfere ait iki hareket bağımsızdı** → `ref_id` ile eşlendi.
16. **Sunucuya sayısal olmayan `delta` gönderilirse sessizce 0/1'e dönüşüyordu** → 422 ile reddedilir.
17. **Mevcut parçaya farklı sayım yöntemiyle ekleme yapılabiliyordu** (Doluluk parçasına adet yazmak gibi). → Engellenir + uyarı.
18. **Kategori kendi alt kategorisine bağlanabiliyordu** (tüm alt ağaç kaybolurdu) → seçenek listesinden çıkarıldı + kayıt guard'ı.
19. **Aynı kod önekiyle iki kategori açılabiliyordu** (SKU çakışması farklı parçaları birleştirirdi) → teklik kontrolü.
20. **Ayarlar > Sistem'de "Dil" başlığı ham anahtar olarak basılıyordu** (`settings.sections.language`) → anahtar eklendi.

### Düşük (yine de düzeltildi)

21. Ad düzenlenince arama etiketleri güncellenmiyordu (eski adla bulunuyordu) → yeniden üretilir.
22. Düzenleme modundan Vazgeç ile çıkılamıyordu → eklendi.
23. Silinmiş konumun kodu hâlâ çözülüyordu → filtrelendi.
24. Aynı özellik anahtarı iki kez tanımlanabiliyor, şablona `{x}-{x}` yazılıyordu → engel + tekilleştirme.
25. Etiket baskısında sayfa sınırındaki etiket ikiye bölünebiliyordu → `break-inside: avoid`.
26. Etiket önizlemesi telefonda yatay taşıyordu → kaydırılabilir kap.
27. Sunucu HTML hata sayfası dönerse uygulama ham `SyntaxError` fırlatıyordu → anlaşılır hata.
28. Dolap/modül QR'ı okutulunca "Bu çekmece boş" görünüyordu → artık **alt konum listesi** gösterilir; gruba "parça ekle" düğmesi çıkmaz.
29. Bozuk UTF-8 içeren yanıt 200 + boş gövde üretebiliyordu → onarımlı kodlama + açık 500.
30. Health ucu DB çökükken gövdede `ok:true` diyordu → `ok` artık gerçek durumu yansıtır.
31. Üye rol açıklaması fiili yetkiyle çelişiyordu → metin gerçeğe uyarlandı.
32. İkon-düğmelerde erişilebilir ad yoktu (düzenle/sil/çıkar) → `aria-label`/`title` eklendi.
33. Parça birden çok konumdayken yinelenen `datalist` id'si üretiliyordu → konum-bazlı id.
34. Koddaki sabit "Diğer" metni i18n'e taşındı.

---

## 4. Bilinen ve BİLİNÇLİ Davranışlar (hata değil)

- **Arşivli parça, aynı kod (SKU) yeniden eklenirse arşivden canlanır** — kayıt geçmişiyle birlikte geri gelir. İstenen davranış olarak bırakıldı.
- **Karantinadaki stok yalnızca aramada gizlenir**; parça detayında görünür (kasıtlı: parçanın nerede olduğu detayda tam görünmeli).
- **Tamamen tükenen (0 adet) parça** arama listesinde "Konum atanmamış" olarak kalır — kaydı silinmez, yeniden stok girilebilir.
- **Miktarı 0'a inen satır çekmece listesinden gizlenir** — "taşındı/tükendi" anlamına gelir; defterde tüm geçmişi durur.
- EN dil dosyası bilinçli boş (SPRINT_PLAN: FAZ 1'de yalnızca altyapı; çeviri sonra).

---

## 5. Açık Kalanlar

Kod değişikliği yapılMAYAN bulgular ve öneriler **Aksiyon Raporu**'nda (`docs/ACTION_REPORT.md`) önceliklendirilmiş olarak listelendi. En önemlileri: konum (çekmece) yönetim ekranının olmayışı, sayım (audit) ekranının olmayışı, parça düzenlemenin dar kapsamı, checksum/self-heal, oturum token'larının düz metin saklanması.
