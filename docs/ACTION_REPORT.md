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
**`web/e2e/audit.mjs`** — gerçek tarayıcıda 109 kontrollük uçtan uca test paketi. Backend gerektirmez. Çalıştırma: `cd web && npm run build && npm run preview`, sonra `node e2e/audit.mjs`. Her bölüm izole çalışır (biri hata verse diğerleri devam eder), sonunda geçen/kalan özeti verir. **Bundan böyle her değişiklik bu 109 senaryodan geçirilebilir** — "elle deneyip hata bulma" döngüsü sona erdi. Buna ek olarak sunucu tarafında `php api/tests/sync_test.php` (41) ve `http_test.php` (22) çalışır.

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

## B. YAPILMAYANLAR (öncelikli yol haritası)

Aşağıdaki her madde, bilinçli olarak **şimdilik yapılmadı**. Her biri için: **ne olduğu, neden önem taşıdığı, kabaca ne iş gerektirdiği ve önceliği** verildi.

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

**Güncel test durumu:** Tarayıcı E2E **109/109** · Sunucu **63/63** · tip denetimi + derleme **temiz**.

---

## D. Önerilen Sıradaki Adım

Plan envanter girişini şart koşuyor; ve elinizde artık bunu yapmak için gereken **iki yeni araç** var (Konum ekranı + Sayım). Önerimiz: **dolaplarınızı/çekmecelerinizi toplu üreticiyle kurun, parçaları girmeye başlayın, saydıkça "Say" ile düzeltin.** Girerken en çok canınızı sıkan şey büyük olasılıkla **B1 (parça düzenlemenin darlığı)** olacaktır — onu ilk fırsatta genişletmeye hazırız; siz deneyip söyleyin.
