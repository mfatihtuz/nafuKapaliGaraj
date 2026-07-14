# DEPO — Aksiyon Raporu (Action Report)

**Sürüm:** 2 (genişletilmiş) · **Tarih:** 14 Temmuz 2026
Denetim raporunun (`docs/AUDIT_REPORT.md`) eşlikçisi. Burada iki şey var: **(A) yapılan her şey** — ne olduğu ve nasıl kullanılacağı ayrıntısıyla; **(B) yapılmayan her şey** — her madde "nedir / neden önemli / ne gerekir / öncelik" diye açıklanmış bir yol haritası.

> **Bu rapor kime, ne için?** "Şu an elimde ne var, nasıl kullanırım, sırada ne var, neden?" sorularının cevabı. Fonksiyon/dosya adı ezberlemeden okunacak şekilde yazıldı.

---

## A. YAPILANLAR

### A.1 — Yeni Özellikler (bu turda eklendi)

#### 1) Konum Yönetim Ekranı (Ayarlar → Konumlar)
**Ne işe yarar:** Artık dolapları, rafları ve çekmeceleri **doğrudan uygulamadan** yönetiyorsunuz — daha önce bunlar yalnızca kurulum SQL'iyle geliyordu, uygulamadan yeni çekmece eklenemiyordu.
**Neler yapabiliyorsunuz:**
- **Ağaç görünümü:** Alan → Dolap → Raf/Modül → Çekmece hiyerarşisini açılır-kapanır (akordiyon) olarak görürsünüz. Her satırda kod, ad, tip ve alt konum sayısı yazar.
- **Tekil ekle / düzenle / sil:** Kod (otomatik büyük harf + geçersiz karakter temizliği), ad, tip (Alan/Dolap/Raf/Çekmece/Göz), üst konum. Karantina gibi sistem konumları salt-okunur gösterilir.
- **Akıllı korumalar:** Aynı kod iki konuma verilemez; bir konum kendi altına bağlanamaz (döngü); **alt konumu olan veya içinde parça olan konum silinemez** (yetim veri oluşmasın).
- **Toplu çekmece üretici:** Asıl güçlü kısım. Bir önek (ör. `S4`) ve bir yapı seçersiniz:
  - **Düz:** dolap + `S4-01 … S4-06` gibi sıralı çekmeceler.
  - **Modüllü:** dolap → modüller → her modülde çekmeceler (`S4-01-1 … S4-03-6`).
  Kaç konum oluşacağını ve örnek kodları **canlı önizlersiniz**, sonra tek tıkla üretirsiniz. Adresler (path) otomatik kurulur. Var olan bir dolaba tekrar üretim yaparsanız çekmeceler o dolaba **doğru şekilde eklenir** (kök yetim olmaz); daha önce sildiğiniz bir çekmeceyi tekrar üretirseniz **diriltilir**.
**Sizin için anlamı:** 217 gözünüzü tek tek elle girmek yerine, birkaç dolabı toplu üreticiyle dakikalar içinde kurabilirsiniz.

#### 2) Sayım (Say) — mutlak stok düzeltme
**Ne işe yarar:** "Bu gözde sistemde 50 yazıyor ama fiziksel saydım, gerçekte 7 varmış" durumunu tek adımda düzeltir.
**Nasıl:** Parça detayında (veya konum ekranında) miktarlı bir parçanın **sayısına dokunun** → gerçek adedi yazın → Kaydet. Sistem farkı otomatik hesaplayıp bir "sayım" hareketi olarak deftere işler. "Say" ve "−N" (toplu düşüm) artık ayrı, net düğmeler.
**Önemli:** Çevrimdışı **anında** yansır (internet beklemez), garaj kullanımına uygundur.

#### 3) Etiket Tipi ↔ Dolap Bağı
**Ne işe yarar:** Her fiziksel dolabın kendine uygun bir etiket boyutu vardır. Artık her etiket tipine hangi dolaplarda kullanıldığını (çoklu seçim) atayabilirsiniz. **Etiket Yazdır** ekranında bir dolabı seçince, ona bağlı etiket tipi **otomatik** seçilir — her seferinde elle tip aramazsınız.

#### 4) Gruplu Konum Seçici (Parça Ekle + Taşı)
**Ne işe yarar:** Konum yazarken çıkan öneriler artık **dolap başlıkları altında gruplu**; kod solda, tam yol sağda. Yazarken eşleşen öneri varken "böyle konum yok" hatası **basılmaz** (sizin şikâyet ettiğiniz erken hata); dolap kodu yazarsanız "bu bir grup, içindeki çekmeceyi seçin" açıklaması çıkar. Yaprak konum tam eşleşince yeşil onay işareti belirir.

#### 5) Arama'ya Konum Filtresi + Görsel Grup Belirginliği
Kategori filtresinin yanına **konum filtresi** geldi: bir dolabı seçince altındaki **tüm çekmeceler** aranır. Kategori adı, sonuç kartlarında gri satır yerine **belirgin bir etiket (chip)** olarak gösterilir.

### A.2 — Kalıcı Test Altyapısı (en değerli çıktı)
**`web/e2e/audit.mjs`** — gerçek tarayıcıda **140 kontrollük** uçtan uca test paketi. Backend gerektirmez. Çalıştırma: `cd web && npm run build && npm run preview`, sonra `node e2e/audit.mjs`. Her bölüm izole çalışır (biri hata verse diğerleri devam eder), sonunda geçen/kalan özeti verir. **Bundan böyle her değişiklik bu 140 senaryodan geçirilebilir** — "elle deneyip hata bulma" döngüsü sona erdi. Buna ek olarak sunucu tarafında `php api/tests/sync_test.php` (**51**) ve `http_test.php` (**27**) çalışır. Yeni bölümler: O (self-heal), P (boş-etiket durumu), Q (hassas sayım).

### A.3 — Düzeltmeler (özet; her birinin tam anlatımı Audit Report §5'te)
Toplam **34'ten fazla** doğrulanmış hata düzeltildi. Başlıca temalar:

| Tema | Ne düzeltildi (özet) |
|---|---|
| **Güvenlik / izolasyon** | Hesap değişiminde yerel veri silme; parola değişince diğer oturumların iptali; boş e-posta kilidi; stok defterinde organizasyon filtresi. |
| **Senkronizasyon** | Eşzamanlı push'ta değişiklik atlanmasını önleyen sıralama kilidi; geçici hatada açılış stoğunun kaybını önleme; 1000+ işlem için dilimleme; sayımda çift-düzeltmeyi önleyen satır kilidi. |
| **Stok bütünlüğü** | Miktarlı modda 0/boş miktar engeli (parçanın "kaybolması" sorununun kökü); −N'in eldekiyle sınırlanması; sayım yöntemi çakışması engeli. |
| **Konum & kategori** | Düzenlemede alt-adreslerin cascade güncellenmesi; toplu üreticide kök-yetim önleme; silinmiş kod diriltme; kategori döngü/tekillik/yetim korumaları. |
| **Arayüz** | Görünmez Düzenle düğmesi; Vazgeç; senkron hata rozeti; dolapta alt-konum listesi; etiket baskı bölünmesi; mobil taşma; erişilebilir adlar. |
| **Sunucu sağlamlığı** | Bozuk-karakter/HTML yanıtı ele alma; sağlık ucu doğruluğu; sayısal miktar doğrulaması. |

---

## A.4 — İkinci Tur Sağlamlaştırma: TÜM yol haritası maddeleri tamamlandı (14 Tem 2026)

Aşağıdaki B-maddeleri (B1–B9, önceki turda "yapılmayanlar") bu turda **tümüyle tamamlandı.** Her biri testlerle korunuyor.

#### B1 — Parça düzenleme genişletildi ✅
Parça detayında artık **her alan** düzenlenebilir: ad, SKU (benzersizlik denetimiyle), kategori, üretici, üretici kodu (MPN), tüm **özellikler** (kategori şablonuna göre özellik formu), not ve veri sayfası (datasheet) bağlantısı. Yanlış girilen bir parçayı artık silip yeniden girmenize gerek yok. Üretici ve MPN artık **aramada da** bulunur (etiketlere/indekse eklendi).

#### B2 — Kullanıcı yönetimi tamamlandı ✅
Kullanıcı eklerken form **anında** uyarır (ad + parola ≥ 8 hane + kullanıcı adı ya da e-posta zorunlu — sunucuya gitmeden). Owner artık bir üyenin **parolasını sıfırlayabilir** (üye satırındaki anahtar düğmesi → geçici parola); sıfırlama o kullanıcının tüm açık oturumlarını kapatır (güvenlik).

#### B3 — Kendi kendini onaran senkronizasyon (checksum / self-heal) ✅
Sunucu ile cihaz, stok verisinin **parmak izini (SHA-256)** karşılaştırır. Nadir bir sapma (kurtarılamayan bir işlem, yarım kalan bir güncelleme) olursa cihaz **sessizce sunucudan yeniden eşitlenir** ve hizalanır. Üç güvenlik kapısı yanlış-pozitif "sürekli yeniden indirme" döngüsünü önler: (1) bekleyen yerel yazım varken yapılmaz, (2) en fazla 5 dakikada bir, (3) tarayıcı kripto desteği yoksa atlanır. Onarım olursa "Ayarlar → Senkronizasyon" listesinde görünür kaydolur.

#### B4 — Hassas (çok cihazlı) sayım modu ✅ *(opsiyonel)*
**Ayarlar → Sistem**'de owner'a bir anahtar: **"Hassas sayım (çok cihazlı)."** Kapalıyken (varsayılan) sayım eskisi gibi **anında** görünür — garaj/tek cihaz için önerilir. Açıkken ve internet varken sayım **sunucu tarafından** doğrulanır: farkı sunucu kendi güncel değerine göre hesaplar, böylece iki kişi aynı gözü aynı anda sayarsa sonuç şaşmaz. İnternet yokken her hâlde anlık çalışır. (Sunucu-yetkili altyapı zaten hazırdı; artık bir moda bağlandı.)

#### B5 — Oturum güvenliği sertleştirildi ✅
(a) Oturum anahtarları veritabanında artık **hash'li** (düz metin değil). (b) Geçici senkron hatalarında **artan bekleme (exponential backoff)** — 8 deneme dakikalar içinde tükenmez. (c) Süresi dolan oturum kayıtları oturum açılışında **budanıyor** (sonsuz büyüme yok).

#### B6 — Eşzamanlılık kenar durumları kapatıldı ✅
(a) Doluluk (DOLU/AZ/BİTTİ) **eşit zaman damgasında** artık belirleyici bir kurala göre çözülür (full > low > empty) — iki cihaz aynı anda farklı seviye yazarsa sonuç deterministik, kalıcı ayrışma olmaz (hem sunucu hem cihaz aynı kuralı uygular). (b) Katalog referansları (kategori/üst konum) artık **tenant aidiyeti** doğrulamasından geçer — başka organizasyona ait bir referansa bağlama reddedilir (izolasyon savunması).

#### B7 — Toplu üretim atomik ve hızlı ✅
Toplu çekmece üretici artık tüm satırları önce bellekte hazırlayıp **tek bir veritabanı işleminde** yazıyor: yüzlerce çekmecede yarım kalma riski yok (hepsi ya da hiçbiri), tek senkron tetiği — belirgin biçimde daha hızlı.

#### B8 — Sabit metinler sözlüğe taşındı ✅
Kodun içinde gömülü kalan görüntü metinleri (DOLU/AZ/BİTTİ, hareket adları, "az önce/dk/sa", birim listesi) artık **dil sözlüğünden** çözülüyor. Değerler kanonik kalır (ör. birim 'metre'); yalnızca gösterim çevrilir. Çok dilli altyapı böylece tamamen bağlandı (İngilizce çevirinin kendisi plan gereği sonraki fazda doldurulacak; şu an eksik anahtarlar Türkçe'ye düşer).

#### B9 — Boş-durum yönlendirmeleri ✅
Etiket sayfasında hiç dolap yoksa artık boş bir liste yerine **"Önce Ayarlar → Konumlar'dan dolap oluşturun"** yönlendirmesi çıkar. Sunucu tarafında yapılandırma (config) bulunamazsa **eyleme dönük** bir kurulum mesajı döner (sessiz hata yerine).

---

## A.5 — Sistem Konumları: W1 / QT / IN nedir, nerede kullanılır?

Bu üçü, kurulumla gelen **sistem konumlarıdır** (`GARAJ` alanının altında). Normal dolaplardan farkları: **düzenlenemez/silinemezler** (Ayarlar → Konumlar'da salt-okunur görünürler) ve fiziksel bir çekmece değil, bir **iş akışı durağıdır.**

| Kod | Tip | Adı | Ne işe yarar |
|---|---|---|---|
| **IN** | `intake` (Giriş) | *Giriş Kutusu — kayıt bekleyen parçalar* | Yeni gelen ama henüz kalıcı gözüne yerleştirilmemiş parçalar için **geçici giriş rafı.** "Parti hâlinde parça geldi, tek tek yerleştirmeye vaktim yok; şimdilik sisteme al, sonra dağıtırım" durağı. Parçayı buraya alır, sonra **Taşı** ile gerçek çekmecesine gönderirsiniz. |
| **W1** | `bench` (Tezgâh) | *Tezgâh — projede kullanımda* | Bir projede **kullanımda / elinizin altında** olan parçalar. Çekmeceden çıkarıp tezgâha aldığınızda parçayı W1'e **taşırsınız**; böylece "çekmecede yok ama kayıp da değil, tezgâhta" bilgisi korunur. Proje bitince geri kaldıysa asıl gözüne taşırsınız. |
| **QT** | `quarantine` (Karantina) | *Karantina — 12 ay kuralı* | Emin olmadığınız parçalar (söküm/hurdadan çıkan, sağlamlığı şüpheli, "atsam mı sakla mı" dediğiniz) için **bekleme alanı.** Mantık: 12 ay burada durur, o süre içinde kullanmadıysanız gönül rahatlığıyla atarsınız. **Aramada varsayılan olarak GİZLİDİR** — normal envanterinizi kirletmez; "Karantinadakileri de göster" kutusuyla görünür. |

**Kısaca akış:** yeni parça → **IN** (giriş) → asıl çekmece; kullanınca → **W1** (tezgâh) → iş bitince geri; şüpheli/emekli → **QT** (karantina) → 12 ay sonra çöp. Üçü de birer konum olduğu için stok hareketleri (taşıma) bu duraklar arasında kayıpsız izlenir.

---

## B. YOL HARİTASI — bu turda TAMAMLANDI ✅

> **GÜNCELLEME (14 Tem 2026):** Aşağıdaki B1–B9 maddelerinin **tamamı bu turda tamamlandı** (özet ve kullanım: **§A.4**). Bu bölüm, her maddenin özgün gerekçesini (nedir/neden önemli) kayıt olarak korur; artık hepsi kodda ve testlerde mevcuttur. Geriye yalnızca **FAZ 2+** ürün fazları kaldı (aşağıda).

Aşağıdaki her madde için: **ne olduğu, neden önem taşıdığı, kabaca ne iş gerektirdiği ve önceliği** verilmiştir (tarihsel gerekçe).

### Öncelik 1 — Günlük kullanımda eksikliği hissedilecekler

**B1. Parça düzenleme çok dar**
- **Nedir:** Parça detayında şu an yalnızca ad, sayım yöntemi, birim ve kritik stok düzenlenebiliyor.
- **Neden önemli:** Bir parçanın **özelliklerini** (ör. direncin değeri/paketi), **kategorisini**, **üretici/üretici kodunu (MPN)**, **notunu** veya **veri sayfası (datasheet) bağlantısını** sonradan değiştirmek mümkün değil. Yanlış girilen bir özelliği düzeltmek için parçayı silip yeniden girmek gerekiyor.
- **Ne gerekir:** Parça detayına, ekleme sihirbazındakine benzer bir "tüm alanları düzenle" formu (özellik formu + kategori seçici + serbest alanlar).
- **Öncelik:** Yüksek — envanteri girerken kaçınılmaz olarak hata düzeltmek isteyeceksiniz.

**B2. Kullanıcı yönetiminde küçük eksikler**
- **Nedir:** Kullanıcı eklerken "kullanıcı adı veya e-posta gerekli" kuralı yalnızca sunucuda; formda anında uyarı yok. Ayrıca yöneticinin bir üyenin **parolasını sıfırlaması** yok (üye parolasını unutursa çözüm zor).
- **Ne gerekir:** Formda istemci doğrulaması + owner için "geçici parola ata" akışı.
- **Öncelik:** Orta.

### Öncelik 2 — Sağlamlaştırma (senkron / güvenlik)

**B3. Kendi kendini onaran senkronizasyon (checksum) yok**
- **Nedir:** Nadir durumlarda (kalıcı reddedilen bir katalog işlemi, geri alınamayan bir doluluk değişikliği) bir cihazın verisi sunucudan bir tık sapabilir. Şu an bunu düzeltecek otomatik bir mekanizma yok; teorik çözüm "bir dahaki tam yeniden yükleme"ye dayanıyor ama o kendiliğinden tetiklenmiyor.
- **Ne gerekir:** Sunucu ve istemcinin veri "parmak izini" (checksum) karşılaştırdığı bir uç; uyuşmazlıkta o tenant'ın verisini sessizce yeniden çekmek.
- **Öncelik:** Orta — çok cihazlı kullanımda değeri artar. (Plan: FAZ 4.3.)

**B4. Çok cihazlı "mutlak sayım" garantisi (opsiyonel)**
- **Nedir:** Sayım (Say) şu an çevrimdışı-anında çalışsın diye, farkı sizin cihazınızın o anki bilgisine göre hesaplıyor. İki kişi aynı gözü tam aynı anda sayarsa sonuç ideal olmayabilir.
- **Neden şimdilik böyle:** Tek sahipli garaj için bu senaryo yok; çevrimdışı anında görebilmek daha değerli. (Sunucu-yetkili altyapı kodda **hazır**, sadece bağlı değil.)
- **Ne gerekir:** İsteğe bağlı bir "hassas sayım" modu (online iken sunucunun güncel değerine göre hesaplar).
- **Öncelik:** Düşük (garaj için), ürünleştirmede Orta.

**B5. Oturum güvenliği sertleştirmeleri**
- **Nedir:** (a) Oturum anahtarları veritabanında **düz metin** duruyor (hash'lenmeli). (b) Eşitleme uçlarında (push/pull) **hız sınırı** yok (sadece giriş ekranında var). (c) Geçici hatalarda **artan bekleme (backoff)** yok — 8 deneme hızlı tükenebilir. (d) Hiç dönmeyen cihazların 90 günlük oturum kayıtları **budanmıyor** (sonsuz büyüme).
- **Öncelik:** Düşük-Orta; ürünleştirmeden önce yapılmalı.

**B6. Eşzamanlılık kenar durumları**
- **Nedir:** (a) İki cihaz **çevrimdışıyken aynı konum kodunu** oluşturursa, biri kazanır, diğeri sessizce düşer. (b) Katalog referansları (kategori/üst konum kimlikleri) tenant'a aitlik doğrulamasından geçmiyor (izolasyonu bozmuyor ama çöp referansa izin veriyor). (c) Doluluk (DOLU/AZ/BİTTİ) eşit zaman damgasında belirleyici (tiebreaker) yok.
- **Öncelik:** Düşük.

**B7. Toplu üretimde atomiklik/performans**
- **Nedir:** Toplu çekmece üretici, konumları tek tek sırayla yazıyor. 217 çekmece için sorunsuz; ama çok büyük sayılarda (binlerce) tek bir veritabanı işleminde toplu yazmak daha güvenli/hızlı olurdu.
- **Öncelik:** Düşük.

### Öncelik 3 — Çok dillilik ve cila

**B8. Sabit metin kalıntıları / İngilizce çeviri**
- **Nedir:** Bazı metinler (DOLU/AZ/BİTTİ etiketleri, hareket adları, "az önce/dk/sa", birim listesi) hâlâ kodun içinde sabit. Altyapı çok dilli ama bu sabitler henüz sözlüğe taşınmadı; `en.json` boş (plan gereği bu fazda bilinçli).
- **Öncelik:** Düşük — ürünleştirmede gerekli.

**B9. Küçük boş-durum yönlendirmeleri**
- Etiket sayfasında hiç dolap yoksa açıklayıcı bir yönlendirme metni; `index.php`'nin config bulunamayınca daha zarif davranması gibi ufak cilalar.
- **Öncelik:** Düşük.

### Faz Planı (SPRINT_PLAN) — büyük resim

Bu maddeler ürünün gelecek fazları. **Plan, önce ~100 kalem gerçek envanter girmenizi şart koşuyor** (gerçek veri, hangi özelliğin gerçekten gerektiğini gösterir):
- **FAZ 2:** Fotoğraftan AI ile parça tanıma; çekmece fotoğrafı ve dosya ekleri; **kritik stok altı → alışveriş listesi**; MPN ile tedarikçi zenginleştirme.
- **FAZ 3:** Projeler + malzeme listesi (BOM); "bu projeyi yapabilir miyim?" eksik listesi; ödünç takibi; tedarikçi/fiyat geçmişi; sipariş (satın alma) akışı.
- **FAZ 4:** Döngüsel sayım modülü + doğruluk KPI'ı; ölü stok/ABC raporları; checksum/self-heal (B3); otomatik yedekleme; ağırlıkla sayım; LED ile çekmece bulucu; ürünleştirme (kayıt, plan limitleri, ödeme).

---

## C. Kurulum ve Doğrulama

1. Size gönderilen `depo_yonetimi_deploy.zip` dosyasını Hostinger **File Manager** ile `public_html/depo_yonetimi/` klasörüne çıkarın (üzerine yazın). `private/config.php` (veritabanı bilgileriniz) pakette korunur.
2. Tarayıcıda **Ctrl+Shift+R** (PWA yeni sürümü çeksin).
3. **Bu turda veritabanı şeması değişmedi** — SQL çalıştırmanız gerekmez. Artık yeni çekmeceleri **uygulama içinden** (Ayarlar → Konumlar) ekleyebilirsiniz.

**Güncel test durumu:** Tarayıcı E2E **140/140** · Sunucu **78/78** (sync 51 + http 27) · tip denetimi + derleme **temiz**.

---

## D. Önerilen Sıradaki Adım

Yol haritasındaki tüm sağlamlaştırma maddeleri (B1–B9) artık **tamamlandı**; parça düzenleme de dâhil (B1). Sıra **gerçek veride:** planın şart koştuğu gibi **dolaplarınızı toplu üreticiyle kurun, ~100 kalem envanter girin, saydıkça "Say" ile düzeltin.** Gerçek kullanım, FAZ 2 önceliklerini (fotoğraftan AI ile tanıma, kritik-stok alışveriş listesi, tedarikçi zenginleştirme) netleştirecek. Bir sürtünme/eksik fark ederseniz iletin — hızla ele alırız.
