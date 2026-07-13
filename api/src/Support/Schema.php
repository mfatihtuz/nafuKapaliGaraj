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
        $col = $db->one(
            "SELECT COUNT(*) AS c FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'username'"
        );
        if ((int) ($col['c'] ?? 0) === 0) {
            $db->run('ALTER TABLE users ADD COLUMN username VARCHAR(60) NULL AFTER email');
            $db->run('ALTER TABLE users ADD UNIQUE KEY uq_users_username (username)');
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
