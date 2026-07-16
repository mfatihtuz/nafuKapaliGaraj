<?php
declare(strict_types=1);

/**
 * DEPO — Yapılandırma şablonu.
 *
 * KURULUM:
 *   1. Bu dosyayı `config.php` olarak kopyala (sunucuda `private/config.php`).
 *   2. Veritabanı bilgilerini Hostinger hPanel > Databases'ten al ve doldur.
 *   3. `config.php` ASLA git'e girmez (bkz. .gitignore).
 *
 * Sunucu yerleşimi (Hostinger, public_html'e kilitli FTP):
 *   public_html/depo_yonetimi/
 *     ├── index.php          (api/public/index.php)
 *     ├── .htaccess          (api/public/.htaccess)
 *     ├── assets/            (web/dist build çıktısı)
 *     └── private/           ← web erişimine KAPALI (.htaccess deny)
 *         ├── config.php     (bu dosya)
 *         ├── src/           (api/src)
 *         └── storage/       (yüklenen dosyalar — Faz 2)
 */

return [
    'db' => [
        'host'    => 'localhost',              // Hostinger'da genelde 'localhost'
        'port'    => 3306,
        'name'    => 'uXXXXXXXXX_depo',        // hPanel > MySQL Databases
        'user'    => 'uXXXXXXXXX_depo',
        'pass'    => 'BURAYA_DB_PAROLASI',
        'charset' => 'utf8mb4',
    ],

    'app' => [
        // Uygulamanın sunucudaki alt yolu. Kök ise '' bırak.
        'base_path' => '/depo_yonetimi',
        'domain'    => 'nafuhome.mftyazilim.com',
        // 'production' | 'development' — development'ta hata detayları JSON'a eklenir.
        'env'       => 'production',
    ],

    'security' => [
        'session_ttl_days' => 90,
        'cookie_name'      => 'depo_session',
        'cookie_secure'    => true,   // HTTPS zorunlu (canlıda true)
        'cookie_samesite'  => 'Lax',
        // İstemci saatinin geleceğe kaçmasına izin verilen tampon (dakika) — SYNC_PROTOCOL §7
        'clock_skew_minutes' => 5,
    ],

    'storage' => [
        // Yüklenen dosyalar (Faz 2). Webroot DIŞI olmalı.
        'path' => __DIR__ . '/storage',
        // Yükleme boyut sınırları (bayt). Foto sunucuda yeniden kodlanır; PDF ham saklanır.
        'max_photo_bytes' => 10 * 1024 * 1024, // 10 MB
        'max_pdf_bytes'   => 20 * 1024 * 1024, // 20 MB
    ],

    // FAZ 2.3/2.5 — AI fotoğraftan tanıma + MPN zenginleştirme (opsiyonel).
    // Anahtar SUNUCUDA kalır, frontend'e ASLA gönderilmez (CLAUDE.md §6).
    // enabled=false veya api_key boşken tüm AI uçları nazikçe devre dışı (200 + disabled).
    'ai' => [
        'enabled' => false,                 // aktive etmek için true + api_key doldur
        'api_key' => '',                    // Anthropic API anahtarı (sk-ant-...)
        'model'   => 'claude-sonnet-5',
        'mpn_lookup' => [
            'enabled' => false,             // 2.5 — sağlayıcı erişimi doğrulanınca aç
        ],
    ],
];
