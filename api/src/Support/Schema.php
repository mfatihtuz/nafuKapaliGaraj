<?php
declare(strict_types=1);

namespace Depo\Support;

use Depo\Core\Db;
use PDO;

/**
 * Canlıda ekstra migration gerektirmeyen, kendi kendine kurulan şema parçaları.
 * Yalnızca MySQL'de çalışır; testlerde (sqlite) ilgili tablolar/sütunlar önceden vardır.
 */
final class Schema
{
    private static bool $usernameChecked = false;
    private static bool $loginAttemptsChecked = false;

    public static function ensureUsername(Db $db): void
    {
        if (self::$usernameChecked || !self::isMysql($db)) {
            self::$usernameChecked = true;
            return;
        }
        // UCUZ kontrol: tablo tanımını kullanan bir SELECT — kolon yoksa fırlatır.
        // (Eski kod her login'de information_schema.COLUMNS sorguluyordu; paylaşımlı
        //  MySQL'de bu saniyeler sürebiliyor ve kolon eksikken üst üste denemeler
        //  ALTER'da metadata-lock ile kilitlenip login'i 20 sn takıyordu.)
        try {
            $db->one('SELECT username FROM users LIMIT 1');
        } catch (\Throwable) {
            // Kolon yok → bir kez ekle. Unique key ayrı denemede (kolon eklenip key
            // kalırsa ikinci login yine denemesin diye hata yutulur).
            try { $db->run('ALTER TABLE users ADD COLUMN username VARCHAR(60) NULL AFTER email'); } catch (\Throwable) {}
            try { $db->run('ALTER TABLE users ADD UNIQUE KEY uq_users_username (username)'); } catch (\Throwable) {}
        }
        self::$usernameChecked = true;
    }

    public static function ensureLoginAttempts(Db $db): void
    {
        if (self::$loginAttemptsChecked || !self::isMysql($db)) {
            self::$loginAttemptsChecked = true;
            return;
        }
        $db->run(
            'CREATE TABLE IF NOT EXISTS login_attempts (
               id CHAR(64) NOT NULL PRIMARY KEY,
               attempts INT UNSIGNED NOT NULL DEFAULT 0,
               first_at DATETIME(3) NOT NULL,
               locked_until DATETIME(3) NULL,
               updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
               KEY idx_la_locked (locked_until)
             ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci'
        );
        self::$loginAttemptsChecked = true;
    }

    private static function isMysql(Db $db): bool
    {
        return $db->pdo()->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
    }
}
