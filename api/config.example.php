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
    ],
];
