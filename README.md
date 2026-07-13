# DEPO — Garaj Elektronik Envanter Sistemi
### Claude Code Proje Paketi

Bu klasör, projeyi Claude Code ile sıfırdan inşa etmen için gereken **tüm tasarım kararlarını** içerir. Kod yok — spesifikasyon var. Kodu Claude Code yazacak.

---

## Bu paketteki dosyalar (okuma sırası)

| # | Dosya | Ne işe yarar |
|---|---|---|
| 1 | `CLAUDE.md` | **Claude Code'un anayasası.** Proje kökene kopyalanır. Stack, kurallar, anti-halüsinasyon protokolü, kod standartları. |
| 2 | `docs/PRD.md` | Ürün gereksinimleri. Ne yapıyoruz, kim için, hangi ekranlar, hangi kabuller. |
| 3 | `docs/ARCHITECTURE.md` | Teknik mimari. Klasör yapısı, API tasarımı, kimlik doğrulama, dosya depolama. |
| 4 | `docs/SYNC_PROTOCOL.md` | **En kritik doküman.** Offline-first senkronizasyon ve çakışma çözümü. Burayı yanlış yaparsan stok verisi bozulur. |
| 5 | `db/schema.sql` | MySQL şeması. Doğrudan çalıştırılabilir. |
| 6 | `db/seed.sql` | Kategori ağacı, öznitelik şablonları, konumların tamamı (senin 217 gözün). |
| 7 | `docs/PHYSICAL_LAYOUT.md` | Fiziksel yerleşim ve adresleme planı. Etiket basımı. |
| 8 | `docs/AI_INTAKE.md` | Fotoğraftan parça tanıma — prompt ve akış. |
| 9 | `docs/SPRINT_PLAN.md` | Faz faz yapılacaklar. Claude Code oturumlarına bölünmüş. |

---

## Başlangıç

```bash
mkdir depo && cd depo
git init
# Bu paketteki dosyaları kopyala:
#   CLAUDE.md  → ./CLAUDE.md
#   docs/*     → ./docs/
#   db/*       → ./db/
git add -A && git commit -m "chore: proje spesifikasyonu"

claude
```

İlk Claude Code komutun:

```
CLAUDE.md, docs/PRD.md, docs/ARCHITECTURE.md ve docs/SYNC_PROTOCOL.md dosyalarını oku.
Sonra docs/SPRINT_PLAN.md içindeki FAZ 0'ı uygula.
Kod yazmadan önce planını bana özetle.
```

---

## Kritik uyarı

**Faz 1 bitmeden Faz 2'ye geçme.** Bu projenin darboğazı kod değil, **veri girişi**. Faz 1 (temel stok + tarayıcı + arama) bittiğinde garajı envanterlemeye BAŞLA. AI tanıma, BOM, ödünç takibi hepsi güzel — ama boş bir veritabanının üstünde çalışmıyorlar.

Hedef: Faz 1 bitiminden itibaren her hafta 2 × 90 dakikalık envanter sprinti.
