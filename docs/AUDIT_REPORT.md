# DEPO — Kapsamlı Denetim Raporu (Full Audit Report)

**Sürüm:** 2 (genişletilmiş) · **Tarih:** 14 Temmuz 2026
**Kapsam:** Uygulamanın tamamı — parça ekleme/çıkarma/güncelleme/taşıma, stok sayımı, konum yönetimi, arama, etiket basımı, çok kullanıcılı senkronizasyon, çevrimdışı (offline) davranış, güvenlik ve mobil uyum.

> **Bu raporu nasıl okumalısınız?**
> Her bulgu beş başlıkta anlatılır: **(1) Nedir** (hangi ekran/özellik), **(2) Sorun neydi**, **(3) Somut senaryo** (adım adım nasıl yaşanırdı), **(4) Neden önemliydi** (size etkisi), **(5) Nasıl çözüldü / nasıl doğrulandı.** Amacımız: teknik detay bilmeden de tam olarak ne olduğunu anlamanız. Yapılmayan işler ve öneriler ayrı belgede: `docs/ACTION_REPORT.md`.

---

## 1. Önce Temel Kavramlar (sözlük)

Raporun geri kalanı bu kavramlara dayanıyor; birkaç dakikanızı ayırın, sonrası çok daha anlaşılır olacak.

- **Offline-first (önce-çevrimdışı):** Uygulama internet olmadan da tam çalışır. Bütün envanterin bir kopyası telefonun/tarayıcının içinde (IndexedDB adlı yerel veritabanında) durur. Siz bir işlem yapınca önce **yerelde** anında uygulanır; internet gelince arka planda sunucuyla eşitlenir. Yani garajda internet çekmese bile parça arar, stok düşer, sayım yaparsınız.
- **Senkronizasyon (eşitleme):** Yerelde yaptığınız değişiklikleri sunucuya gönderme ve sunucudaki değişiklikleri alma işi. Yaptığınız her işlem önce bir **bekleme kuyruğuna** (outbox) yazılır, sonra sırayla sunucuya "itilir" (push). Sunucudaki yenilikler de "çekilir" (pull).
- **Defter (ledger):** Stok, doğrudan bir sayı olarak değil, **hareketlerin toplamı** olarak tutulur. "+50 aldım", "−3 kullandım", "−10 taşıdım" gibi her hareket kalıcı bir satır olarak yazılır ve asla silinmez; mevcut miktar bu hareketlerin toplamıdır. Bu, iki cihaz aynı anda stok düşerse ikisinin de sayılmasını garanti eder (bir sayıyı üzerine yazmak yerine).
- **Sayım yöntemi (count mode):** Her parça üç yöntemden biriyle takip edilir:
  - **Miktarlı (exact):** Kesin adet tutulur (ör. 240 direnç, 100 metre kablo).
  - **Doluluk (level):** Sayı tutulmaz; sadece **DOLU / AZ / BİTTİ** durumu (ör. bir kutu vida — saymak yerine göz kararı).
  - **Takipsiz (unmanaged):** Sadece "burada var" bilgisi; miktar hiç tutulmaz.
- **Konum ağacı:** Fiziksel yerler bir ağaç olarak modellenir: **Alan → Dolap → Raf/Modül → Çekmece/Göz.** Örneğin `GARAJ → S3 → S3-01 → S3-01-1`. Parça daima en alttaki gerçek gözde (yaprak) durur; dolap/modül sadece gruptur.
- **Materyalize yol (path):** Her konumun tam adresi metin olarak da saklanır: `GARAJ/S3/S3-01/S3-01-1`. Etiket basımı ve konum araması bu metne bakar; bu yüzden dolap adı değişince altındaki tüm adreslerin de güncellenmesi şarttır (aşağıda bir bulgu tam olarak bununla ilgili).
- **Çok kullanıcılılık / tenant (organizasyon):** Sistem birden çok atölyeye hizmet verebilir. Her sorgu, yalnızca **o organizasyona ait** veriyi görür; bir organizasyonun verisi asla başkasına sızmamalıdır. Buna "tenant izolasyonu" denir.
- **Misafir (viewer) rolü:** Sadece görüntüleyen, hiçbir değişiklik yapamayan kullanıcı.
- **SKU / parça kodu:** Parçanın tekil, İngilizce/ASCII kodu (ör. `R-10K-0805`). Kategorinin şablonundan ve parça özelliklerinden otomatik türetilir.

---

## 2. Denetim Nasıl Yapıldı? (üç bağımsız katman)

Tek bir yönteme güvenmedik; birbirini denetleyen **üç ayrı kanıt katmanı** kullandık. Bir katmanın kaçırdığını diğeri yakalar.

### Katman 1 — Tarayıcı E2E testleri (uçtan uca, gerçek kullanıcı gibi)
`web/e2e/audit.mjs` dosyası, **gerçek bir tarayıcıda (Chromium)** uygulamayı açar ve tıpkı bir kullanıcı gibi tıklar: kategori seçer, özellik doldurur, "Kaydet"e basar, stok düşürür, taşır, siler. Her adımdan sonra **yerel veritabanına bakıp** sonucun doğru olup olmadığını kontrol eder. Şu an **140 ayrı kontrol** var ve **hepsi geçiyor**. Bu dosya artık kalıcı olarak depoda; her değişiklikten sonra `node e2e/audit.mjs` ile tüm senaryolar yeniden koşulabilir. **Sizi "her yeni özellikte elle deneyip hata bulma" döngüsünden kurtaran şey budur.**

### Katman 2 — Sunucu (PHP) testleri
`api/tests/` altındaki iki dosya, senkronizasyon protokolünü ve güvenlik/oturum mantığını doğrular: **41 + 22 = 63 kontrol**, hepsi geçiyor. Özellikle şunları kanıtlar: aynı işlemi iki kez göndermek stoğu iki kez saymaz (idempotency); iki cihazın stok düşüşleri toplanır; bir organizasyonun verisi diğerine sızmaz; hatalı giriş denemeleri kilitlenir.

### Katman 3 — Statik düşmanca inceleme (adversarial review)
Kodu okuyup **"burada ne bozulabilir?"** diye saldıran, sonra her iddiayı **ikinci bir bağımsız ajanla çürütmeye çalışan** çok-ajanlı bir inceleme çalıştırdık (7 boyut: CRUD bütünlüğü, senkronizasyon yarışları, tenant güvenliği, çevrimdışı dayanıklılık, veri modeli mantığı, arayüz boşlukları, sunucu sağlamlığı). Bu süreç toplam **80'den fazla ham iddia** üretti; her biri kod üzerinde tek tek doğrulandı. **Yalnızca doğrulananlar düzeltildi**; asılsız çıkanlar (çoğunluk) elendi. Son olarak yeni yazılan Konum + Sayım ekranları için ayrı bir düşmanca inceleme daha yapıldı ve çıkan gerçek bulgular da düzeltildi (bkz. §5.7).

---

## 3. Ne Test Edildi? (kapsam matrisi)

Aşağıdaki her satır, gerçek tarayıcıda tıklanarak sürülen bir akıştır. Parantez içindeki sayı, o akıştaki kontrol sayısıdır.

| Alan | Neyi kanıtlıyor |
|---|---|
| **Parça Ekle** (18) | 3 adımlı sihirbaz baştan sona çalışıyor; kategori grupları doğru; parça kodu (SKU) canlı önizleniyor; aynı kodlu parça tekrar girilince **yeni parça oluşmuyor, mevcut olana ekleniyor**; art arda ekleme modu kategoriyi sabit tutuyor; üç sayım yöntemi de (miktarlı/doluluk/takipsiz) doğru kaydediyor; **parça yalnızca gerçek çekmeceye eklenebiliyor** (dolap/modül reddediliyor); boş miktar engelleniyor. |
| **Parça Detay** (20) | Ad ve sayım yöntemi düzenleniyor; `+1 / −1 / −N` ve **Say (mutlak sayım)** çalışıyor; stok eksiye düşürülemiyor; parça başka çekmeceye taşınıyor (dolaba taşıma engelli); doluluk (DOLU/AZ/BİTTİ) değişiyor; parça arşivleniyor ama **hareket geçmişi korunuyor**. |
| **Konum Ekranı** (9) | Bir çekmecedeki parçalar listeleniyor; arşivli parça görünmüyor; buradan stok değiştiriliyor; **dolap taranınca içindeki çekmeceler listeleniyor** ("boş çekmece" yanılgısı yok); tükenmiş (0 adet) satırlar gizli. |
| **Arama** (8) | Boş arama tüm envanteri getiriyor; **Türkçe karakter duyarsız** ("direnc" → "Direnç"); üst kategori seçilince alt kategoriler de kapsanıyor; **konum filtresi** (dolap seçilince tüm çekmeceleri); karantina gizli/açılabilir. |
| **Kategoriler** (8) | Kategori ve alt kategori ekleniyor, kod otomatik temizleniyor; düzenleme; **alt kategorisi olan silinemiyor** (yetim kalmasın); parça kodu şablonu "koda girer" kutularından otomatik oluşuyor; seçenek listesi yazımı düzgün. |
| **Konum Yönetimi** (11) | Konum ağacı; tekil ekle/düzenle/sil; **kod tekilliği, döngü, alt-konum ve stok koruması**; **toplu çekmece üretici**; **düzenlemede alt konum adresleri de güncelleniyor**; var olan dolaba çekmece eklenince yetim kalmıyor. |
| **Etiket Ayarları + Basım** (6+3) | Varsayılan tipler; A4'e sığan sütun/satır **otomatik hesaplanıyor**; **etiket tipine dolap atanınca, basımda dolap seçilince tip otomatik geliyor**; QR üretiliyor. |
| **Misafir (viewer)** (8) | Menüde "Ekle" yok; düzenle/taşı/arşiv/stok kontrolleri yok; owner-özel bölümler gizli — **tam salt-okunur**. |
| **Tara / Offline / Mobil / Kullanıcılar** (15) | Manuel kod girişi; **API tamamen kapalıyken bile stok işlemi yerelde çalışıyor** ve kuyrukta bekliyor; 375px ekranda yatay taşma yok, dokunma hedefleri ≥ 40px; ekip listesi ve kullanıcı ekleme. |

---

## 4. Genel Sonuç

- **Tarayıcı E2E: 140 / 140 geçti.** (ilk tur 109 → ikinci tur sağlamlaştırmayla 140)
- **Sunucu (PHP): 78 / 78 geçti.** (sync 51 + http 27)
- **Tip denetimi + derleme (tsc + vite build): temiz.**
- Denetim boyunca bulunan ve **doğrulanan tüm hatalar düzeltildi** (aşağıda). Asılsız çıkan iddialar açıkça elendi.
- **İkinci tur (14 Tem 2026):** yol haritasındaki tüm sağlamlaştırma maddeleri (B1–B9) tamamlandı — bkz. `docs/ACTION_REPORT.md §A.4`. Yeni testler: self-heal (checksum), çapraz-tenant referans savunması, doluluk eşit-zaman tiebreaker'ı, toplu üretim atomikliği, boş-etiket durumu, hassas sayım.

---

## 5. Bulunan ve Düzeltilen Hatalar (detaylı)

Aşağıdaki her madde, gerçekten yaşayabileceğiniz bir sorunun tam anatomisidir.

### 5.1 — Kimlik / Çok kullanıcılı güvenlik

**① Farklı hesapla girince önceki hesabın verisi cihazda kalıyordu (kritik izolasyon açığı)**
- **Nedir:** Aynı cihazda önce bir kullanıcı, sonra başka bir kullanıcı (belki başka bir atölyeden) giriş yapabilir.
- **Sorun:** Oturum düştükten sonra farklı biri girse bile, önceki organizasyonun tüm envanteri hâlâ cihazın yerel veritabanında duruyordu.
- **Senaryo:** Ortak bir tablette Atölye A'nın sahibi çıkış yapar, Atölye B'nin sahibi girer → B, A'nın parçalarını görebilirdi.
- **Neden önemli:** Bu, çok kullanıcılı bir sistemde en ciddi hata türüdür — bir müşterinin verisi başkasına sızar.
- **Çözüm:** Artık farklı kullanıcı **veya** farklı organizasyon girişi algılanınca, önceki tüm yerel veri (envanter + bekleyen işlemler) **silinir**, sonra yeni hesabın verisi çekilir.

**② Çıkış (logout) gönderilmemiş işlemleri sessizce siliyordu (veri kaybı)**
- **Nedir:** Çıkış yapınca yerel veri temizlenir (yukarıdaki güvenlik gereği).
- **Sorun:** Çevrimdışıyken yaptığınız ve henüz sunucuya gitmemiş işlemler (stok düşüşleri vb.) çıkışta hiç uyarı olmadan yok oluyordu.
- **Senaryo:** Garajda internetsiz 20 stok hareketi yaptınız, sonra çıkış yaptınız → 20 hareket kayboldu.
- **Çözüm:** Çıkışta önce eşitleme denenir; hâlâ bekleyen işlem varsa **"N işlem henüz gönderilmedi, çıkarsanız kaybolur, yine de çıkılsın mı?"** diye sorulur. Sessiz kayıp yok.

**③ Parola değişince diğer cihazlardaki oturumlar açık kalıyordu**
- **Sorun:** Parolanızı değiştirseniz bile, başka bir cihazda (belki çalınmış) açık kalan oturum 90 güne kadar geçerliliğini koruyordu.
- **Çözüm:** Parola değişince, **mevcut oturum hariç** o kullanıcının tüm oturumları anında geçersiz kılınır.

**④ E-postayı boş bırakınca hesap kilitlenebiliyordu**
- **Sorun:** Profil ekranında e-posta alanı boşaltılıp kaydedilirse, sistem boş bir e-posta yazıyordu; bu hem başka boş e-postalarla çakışıyor hem de o kullanıcının bir daha giriş yapamamasına yol açabiliyordu.
- **Çözüm:** Boş e-posta artık yazılmaz; eğer kullanıcının kullanıcı adı da yoksa (giriş için başka yolu kalmayacağı için) işlem engellenir.

### 5.2 — Senkronizasyon (eşitleme) doğruluğu

**⑤ Aynı anda iki cihaz eşitlenince bir değişiklik kalıcı olarak atlanabiliyordu (sessiz sapma)**
- **Nedir:** Sunucu, her değişikliğe artan bir sıra numarası verir; cihazlar "en son gördüğüm numaradan sonrasını ver" diyerek yenilikleri çeker.
- **Sorun:** İki cihaz **tam aynı anda** işlem gönderirse, bu sıra numaralarının **atanma sırası** ile **kalıcılaşma (commit) sırası** ayrışabiliyordu. Araya giren üçüncü bir cihaz, numarayı ileri taşıyıp henüz kalıcılaşmamış küçük numaralı satırı **bir daha asla** görmüyordu.
- **Senaryo:** A ve B cihazları aynı saniyede stok hareketi yollar, C bu arada eşitlenir → A'nın hareketi C'ye hiç ulaşmaz; C'nin stoğu sessizce ve kalıcı olarak yanlış kalır.
- **Neden önemli:** Bu, fark edilmesi çok zor, "neden bu cihazda sayı tutmuyor?" dedirten sinsi bir hatadır.
- **Çözüm:** Artık her organizasyonun eşitleme işlemleri **sıraya sokuluyor** (veritabanı seviyesinde bir kilit ile). Böylece numaraların atanma ve kalıcılaşma sırası hep aynı. Bu yöntem paylaşımlı hostingde çalışır.

**⑥ Yeni parçanın açılış stoğu, geçici bir sunucu hatasında kalıcı kaybolabiliyordu**
- **Nedir:** Yeni parça girerken iki şey birlikte gönderilir: parçanın kendisi + ilk stok hareketi ("100 adet aldım").
- **Sorun:** Parçanın kaydı **geçici** bir hata alırsa (ör. anlık veritabanı yoğunluğu), ona bağlı stok hareketi "böyle bir parça yok" diye **kalıcı** reddediliyor ve geri alınıyordu. Parça biraz sonra oluşuyordu ama **stoğu 0** kalıyordu.
- **Çözüm:** Artık, bekleyen bir parça kaydı varken gelen "bulunamadı" reddi **geçici** sayılır; stok hareketi kuyrukta bekler, parça oluşunca uygulanır.

**⑦ Bekleyen kuyruk 1000 işlemi aşınca eşitleme sonsuza dek tıkanıyordu**
- **Sorun:** Sunucu tek seferde en fazla 1000 işlem kabul ediyor. Uzun süre çevrimdışı kalıp 1000'den fazla işlem biriktirdiyseniz, tüm gönderim **hata** alıp bir daha asla ilerlemiyordu.
- **Çözüm:** Kuyruk artık **500'lük dilimler** hâlinde gönderiliyor; ne kadar birikirse biriksin sırayla boşalıyor.

**⑧ Eşitleme hatası "Güncel" rozetiyle maskeleniyordu**
- **Sorun:** Arka planda eşitleme başarısız olsa bile üstteki durum rozeti yeşil "Güncel" gösteriyordu; sorun görünmez kalıyordu.
- **Çözüm:** Son eşitleme hata verdiyse artık kırmızı **"Eşitleme sorunu"** rozeti çıkıyor (üstüne gelince nedenini gösteriyor).

### 5.3 — Stok ve veri bütünlüğü

**⑨ Miktarlı parça 0 veya boş miktarla eklenebiliyor, sonra "kayboluyordu"**
- **Nedir / Sorun:** Miktarlı bir parçayı adet girmeden kaydedince, parça **0 stokla** oluşuyordu. 0 stoklu satırlar (taşınmış/tükenmiş sayıldığı için) listelerden gizlendiğinden, parça **hiç görünmüyordu** — sizin daha önce yaşadığınız "adet girdim ama 0 görünüyor / parça kayboldu" şikâyetinin tam kökü buydu.
- **Çözüm:** Miktarlı modda **adet zorunlu ve 0'dan büyük** olmalı; aksi hâlde "Kaydet" pasif kalıyor.

**⑩ "−N" ile eldekinden fazlası düşülüp stok eksiye inebiliyordu**
- **Sorun:** Toplu düşüm (`−N`) alanına eldekinden büyük bir sayı yazınca stok sessizce eksiye iniyordu; eksi satırlar da gizlendiği için parça kayboluyordu.
- **Çözüm:** Düşüm eldeki miktarla sınırlandı; ayrıca `−1` düğmesi sıfırda pasif.

**⑪ Aynı anda iki sayım, düzeltmeyi çift uyguluyordu**
- **Nedir:** "Sayım" (audit), fiziksel olarak saydığınız gerçek adedi mutlak değer olarak ayarlar.
- **Sorun (sunucu tarafı):** İki cihaz aynı gözü aynı anda sayarsa, ikisi de "mevcut 10, sayılan 7 → 3 düş" hesabını yapıp uyguluyor, sonuç 7 yerine **4** oluyordu.
- **Çözüm:** Sunucuda sayım sırasında ilgili satır **kilitleniyor** (okuma→yazma arası kimse araya giremiyor).

**⑫ Mevcut parçaya farklı sayım yöntemiyle ekleme yapılabiliyordu**
- **Sorun:** "Doluluk" ile takip edilen bir parçaya, aynı kodla yeniden girişte yanlışlıkla "miktarlı" veri yazılabiliyor, stok bozuluyordu.
- **Çözüm:** Aynı koda ekleme yaparken sayım yöntemi uyuşmuyorsa engelleniyor ve açıklayıcı uyarı çıkıyor.

**⑬ Sunucuya sayısal olmayan miktar gönderilirse sessizce 0/1'e dönüyordu**
- **Çözüm:** Sunucu artık sayısal olmayan miktarı açıkça reddediyor.

### 5.4 — Kategori ve konum yapısı

**⑭ Alt kategorisi olan kategori silinince çocuklar "yetim" kalıyordu**
- **Sorun:** Bir üst kategoriyi silince altındaki kategoriler bir yere bağlı kalmadığından ağaçtan kayboluyordu.
- **Çözüm:** Alt kategorisi olan kategori silinemez; açıklayıcı uyarı çıkar.

**⑮ Kategori kendi alt kategorisine bağlanabiliyordu (döngü)**
- **Sorun:** Bir kategori üst kategori olarak kendi altındakini seçince ağaç kendine dönüyor, tüm alt dal kayboluyordu.
- **Çözüm:** Kendisi ve altları üst-kategori seçeneklerinden çıkarıldı + kayıtta ikinci bir kontrol.

**⑯ Aynı kod önekiyle iki kategori açılabiliyordu**
- **Sorun:** Aynı önek iki kategoride olursa, farklı parçaların kodları çakışıp yanlışlıkla birleşebiliyordu.
- **Çözüm:** Kod öneki tekilliği zorunlu kılındı.

**⑰ Konum düzenlemede alt konum adresleri (path) bayatlıyordu (Konum ekranı incelemesinde bulundu — YÜKSEK)**
- **Nedir:** Her konumun tam adresi metin olarak da saklanır (`GARAJ/S3/S3-01`). Etiket basımı ve konum araması bu metne bakar.
- **Sorun:** Bir dolabın kodunu veya üst konumunu değiştirince, **yalnızca o konumun** adresi güncelleniyor; **altındaki tüm çekmecelerin** adresi eski hâlde kalıyordu. Ağaç görünümünde her şey normal görünüyordu (çünkü ağaç, adrese değil ebeveyn bağına bakar), ama etiket basımı ve arama bozuluyordu.
- **Senaryo:** S4 dolabının kodunu S5 yaptınız → dolabın adresi "S5" oldu ama çekmeceler hâlâ "S4/S4-01". Etiket ekranında S5'i seçince **hiç çekmece çıkmıyor** (adresler tutmuyor), QR basamıyorsunuz.
- **Çözüm:** Artık kod veya üst değişince **tüm alt ağacın adresi yeniden yazılıyor** (cascade). E2E ile doğrulandı.

**⑱ Silinmiş konumun kodu hâlâ "geçerli" sayılıyordu**
- **Sorun:** Silinmiş bir konumun kodu, konum aramada eşleşmeye devam edebiliyordu.
- **Çözüm:** Silinmiş konumlar kod çözümünden çıkarıldı.

### 5.5 — Toplu çekmece üretici (Konum ekranı incelemesinde bulundu)

**⑲ Var olan bir dolabın önekiyle üretince çekmeceler "kök yetim" oluyordu (YÜKSEK)**
- **Nedir:** Toplu üretici, bir dolap + altına sıralı çekmeceler oluşturur (ör. S4 → S4-01…S4-06).
- **Sorun:** Zaten S4 dolabı varken tekrar S4 önekiyle çekmece üretmek istediğinizde ("bu dolaba biraz daha çekmece ekleyeyim"), yeni çekmeceler **hiçbir dolaba bağlanmadan** kök seviyede oluşuyordu; adresleri ise "S4/S4-01" diyordu — yani **bağ ile adres birbiriyle çelişiyordu.** Üstelik başarı mesajı çıktığı için fark edilmiyordu.
- **Çözüm:** Üretici artık "**bul-dirilt-oluştur**" mantığıyla çalışıyor: aynı kodda konum varsa onu yeniden kullanır (çekmeceler doğru dolaba bağlanır), silinmişse diriltir, yoksa yeni oluşturur. E2E ile doğrulandı (var olan dolaba ekleme).

**⑳ Silinmiş bir kodu yeniden üretmek sunucuda çakışabilirdi (ORTA)**
- **Nedir:** Konum kodları veritabanında tekildir (`UNIQUE`).
- **Sorun:** Silinmiş bir çekmecenin kodunu tekrar oluşturmaya çalışınca, istemci silinmişleri saymadığı için "kod boş" sanıyor ama sunucudaki tekillik kuralı çakışabiliyordu.
- **Çözüm:** Tekillik kontrolü artık **silinmişler dâhil** yapılıyor; toplu üretici silinmiş çekmeceyi (aynı kimlikle) **diriltiyor.**

### 5.6 — Arayüz ve kullanılabilirlik

**㉑ Parça detayındaki "Düzenle" düğmesi görünmezdi** (beyaz başlık üzerinde beyaz ikon). "Düzenleme yok" sanmanızın muhtemel sebebiydi. → Koyu renge çevrildi + erişilebilir ad eklendi.
**㉒ Düzenleme modundan "Vazgeç" yoktu** — tek çıkış "Kaydet"ti. → Vazgeç eklendi.
**㉓ Dolap QR'ı okutulunca "Bu çekmece boş" görünüyordu.** → Artık dolap taranınca **içindeki çekmeceler listeleniyor**; gruba "parça ekle" düğmesi çıkmıyor.
**㉔ Ad değiştirilince arama eski ada takılıyordu.** → Ad/özellik değişince arama etiketleri yeniden üretiliyor.
**㉕ Etiket baskısında sayfa sonundaki etiket ikiye bölünebiliyordu.** → Bölünme engellendi (`break-inside: avoid`).
**㉖ Etiket önizlemesi telefonda yatay taşıyordu.** → Kendi içinde kaydırılabilir yapıldı.
**㉗–㉚** İkon-düğmelere erişilebilir adlar (düzenle/sil/çıkar/taşı); parça birden çok konumdayken yinelenen HTML kimliği; "Diğer" gibi sabit metinlerin i18n'e taşınması; Ayarlar > Sistem'de ham anahtar basan "Dil" başlığı; üye rol açıklamasının gerçek yetkiyle uyumsuzluğu.

### 5.7 — Sunucu sağlamlığı

**㉛ Bozuk karakter içeren yanıt "boş gövdeyle 200" dönebiliyordu.** → Onarımlı kodlama + başarısızsa açık 500.
**㉜ Sunucu HTML hata sayfası dönerse uygulama çöküyordu** (ham ayrıştırma hatası). → Anlaşılır hataya çevrildi.
**㉝ Sağlık ucu (health) veritabanı çökükken bile gövdede "ok:true" diyordu.** → Artık gerçek durumu yansıtıyor.
**㉞ Stok defterinde dönüş sorgusu organizasyon filtresi içermiyordu** (savunma derinliği eksiği). → Filtre eklendi.

---

## 6. Bilinçli Tasarım Kararları (hata değil)

Bunlar "bulgu" değil; **bilerek** böyle bırakıldı. Şeffaflık için listeliyoruz:

- **Sayım (Say) çevrimdışı anında yansır, çok cihazlı "mutlak doğruluk" garantisi vermez.** Sayım, "bu gözde gerçekte 7 varmış" düzeltmesidir. İki farklı kişi aynı gözü tam aynı anda farklı sayarsa, teorik olarak son değer sizin cihazınızın o anki bilgisine göre hesaplanır. **Tek sahipli bir garaj atölyesi** için bu senaryo pratikte oluşmaz ve çevrimdışı anında görebilmek (internet beklemeden) çok daha değerli olduğundan bu yol seçildi. (Çok cihazlı senaryo için sunucu-yetkili bir sayım altyapısı kodda mevcut; ürünleştirmede devreye alınabilir — bkz. Action Report.)
- **Tükenen (0 adet) miktarlı satırlar çekmece ve arama listelerinden gizlenir** ("boş" satırlar listeyi şişirmesin diye — sizin "adet 0 görünüyor" itirazınızın çözümü). Defterde tüm geçmiş durur; parçayı tekrar stoklayınca yine görünür.
- **Karantinadaki stok yalnızca aramada gizlenir**, parça detayında görünür (parçanın nerede olduğu detayda tam görünsün diye).
- **Arşivlenen parça, aynı kod tekrar eklenirse geçmişiyle canlanır** (silinmek yerine gizlenir; hareket kayıtları korunur).
- **İngilizce dil dosyası bilinçli olarak boş** (plan gereği bu fazda yalnızca altyapı; çeviriler ürünleştirmede).

---

## 7. Açık Kalanlar

**GÜNCELLEME (14 Tem 2026):** İlk turda burada listelenen üç ana açık maddenin **üçü de kapatıldı** — (a) parça düzenleme genişletildi (B1), (b) checksum/self-heal eklendi (B3), (c) oturum anahtarları hash'lendi (B5). Aynı şekilde yol haritasındaki diğer sağlamlaştırma maddeleri de (B2, B4, B6, B7, B8, B9) tamamlandı. Ayrıntı ve kullanım: **`docs/ACTION_REPORT.md §A.4`.**

Geriye kalan açık işler artık yalnızca **ürün fazlarıdır** (FAZ 2+): fotoğraftan AI ile parça tanıma, kritik-stok → alışveriş listesi, projeler/BOM, ödünç takibi, tedarikçi zenginleştirme, döngüsel sayım KPI'ları. Bunlar plan gereği **~100 kalem gerçek envanter girildikten sonra** ele alınacak (gerçek veri, hangi özelliğin gerçekten gerektiğini gösterir).
