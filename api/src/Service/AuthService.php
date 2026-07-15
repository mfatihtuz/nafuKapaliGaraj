<?php
declare(strict_types=1);

namespace Depo\Service;

use Depo\Core\Db;
use Depo\Core\HttpException;
use Depo\Core\Uuid;
use Depo\Support\Time;

/**
 * Kimlik doğrulama (ARCHITECTURE §3): Argon2id parola + opak session token.
 * JWT kullanılmaz (tek origin).
 */
final class AuthService
{
    public function __construct(
        private readonly Db $db,
        private readonly int $sessionTtlDays = 90,
    ) {}

    /**
     * Yeni kullanıcı + tenant (ürünleştirme / self-servis kayıt).
     * @return array{token:string,user:array<string,mixed>,tenant:array<string,mixed>,role:string}
     */
    public function register(string $email, string $password, string $displayName, string $ip = '0.0.0.0'): array
    {
        // Kaba-kuvvet/toplu kayıt koruması (ip başına).
        $key = $this->throttleKey($ip, 'register');
        $this->throttleAssert($key);
        $this->throttleFail($key);

        $email = mb_strtolower(trim($email));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw HttpException::unprocessable('Geçersiz e-posta');
        }
        if (mb_strlen($password) < 8) {
            throw HttpException::unprocessable('Parola en az 8 karakter olmalı');
        }
        $displayName = trim($displayName) !== '' ? trim($displayName) : 'Kullanıcı';

        $exists = $this->db->one('SELECT id FROM users WHERE email = :e', ['e' => $email]);
        if ($exists !== null) {
            throw HttpException::conflict('Bu e-posta zaten kayıtlı', 'email_taken');
        }

        return $this->db->transaction(function () use ($email, $password, $displayName) {
            $userId = Uuid::v7();
            $tenantId = Uuid::v7();

            $this->db->run(
                'INSERT INTO users (id, email, password_hash, display_name) VALUES (:id, :e, :h, :n)',
                ['id' => $userId, 'e' => $email, 'h' => \Depo\Support\Password::hash($password), 'n' => $displayName]
            );
            $this->db->run(
                'INSERT INTO tenants (id, name, plan, locale) VALUES (:id, :name, :plan, :locale)',
                ['id' => $tenantId, 'name' => $displayName . ' Atölyesi', 'plan' => 'free', 'locale' => 'tr']
            );
            $this->db->run(
                'INSERT INTO tenant_users (tenant_id, user_id, role) VALUES (:t, :u, :r)',
                ['t' => $tenantId, 'u' => $userId, 'r' => 'owner']
            );

            $token = $this->createSession($userId, $tenantId);
            return [
                'token'  => $token,
                'user'   => ['id' => $userId, 'email' => $email, 'display_name' => $displayName],
                'tenant' => ['id' => $tenantId, 'name' => $displayName . ' Atölyesi', 'locale' => 'tr'],
                'role'   => 'owner',
            ];
        });
    }

    /**
     * Giriş. Başarılıysa yeni session token döner.
     * @return array{token:string,user:array<string,mixed>,tenant:array<string,mixed>,role:string}
     */
    public function login(string $identifier, string $password, string $ip = '0.0.0.0'): array
    {
        $this->ensureUserSchema();
        $identifier = trim($identifier);
        $lower = mb_strtolower($identifier);
        // Kaba-kuvvet koruması (ip + kimlik başına). Kilitliyse 429.
        $key = $this->throttleKey($ip, 'login:' . $lower);
        $this->throttleAssert($key);

        // Kullanıcı adı VEYA e-posta ile giriş (collation aksan/harf duyarsız).
        $user = $this->db->one(
            'SELECT id, email, username, password_hash, display_name FROM users WHERE email = :e OR username = :u',
            ['e' => $lower, 'u' => $identifier]
        );
        // Zamanlama sızıntısını azalt: kullanıcı yoksa da (aynı maliyetli) bir hash doğrula.
        if ($user === null) {
            password_verify($password, \Depo\Support\Password::DUMMY_HASH);
            $this->throttleFail($key);
            throw HttpException::unauthorized('E-posta veya parola hatalı');
        }
        if (!password_verify($password, (string) $user['password_hash'])) {
            $this->throttleFail($key);
            throw HttpException::unauthorized('E-posta veya parola hatalı');
        }
        // Başarılı giriş → sayaç sıfırla.
        $this->throttleReset($key);

        $membership = $this->db->one(
            'SELECT tenant_id, role FROM tenant_users WHERE user_id = :u ORDER BY created_at ASC LIMIT 1',
            ['u' => $user['id']]
        );
        if ($membership === null) {
            throw HttpException::forbidden('Bu kullanıcının atölyesi yok');
        }

        $tenant = $this->db->one(
            'SELECT id, name, locale FROM tenants WHERE id = :id',
            ['id' => $membership['tenant_id']]
        );

        // Parola rehash gerekiyorsa güncelle (ör. eski 64MB hash → 19MB): başarılı
        // login'de düz parola eldeyken kademeli, kesintisiz geçiş. needsRehash'e de
        // OPTS geçilir (Password içinde) yoksa her login'de gereksiz rehash olur.
        if (\Depo\Support\Password::needsRehash((string) $user['password_hash'])) {
            $this->db->run('UPDATE users SET password_hash = :h WHERE id = :id',
                ['h' => \Depo\Support\Password::hash($password), 'id' => $user['id']]);
        }

        $token = $this->createSession((string) $user['id'], (string) $membership['tenant_id']);
        return [
            'token'  => $token,
            'user'   => ['id' => $user['id'], 'email' => $user['email'], 'username' => $user['username'] ?? null, 'display_name' => $user['display_name']],
            'tenant' => $tenant,
            'role'   => (string) $membership['role'],
        ];
    }

    public function logout(string $token): void
    {
        $this->db->run('DELETE FROM sessions WHERE token = :t', ['t' => self::hashToken($token)]);
    }

    /** @return array<string,mixed> */
    public function me(string $userId, string $tenantId, string $role): array
    {
        $this->ensureUserSchema();
        $user = $this->db->one('SELECT id, email, username, display_name FROM users WHERE id = :id', ['id' => $userId]);
        $tenant = $this->db->one('SELECT id, name, locale, settings FROM tenants WHERE id = :id', ['id' => $tenantId]);
        if ($tenant !== null && is_string($tenant['settings'] ?? null)) {
            $tenant['settings'] = json_decode($tenant['settings'], true);
        }
        return ['user' => $user, 'tenant' => $tenant, 'role' => $role];
    }

    // --- Kaba-kuvvet koruması (login_attempts) ------------------------------

    private const TH_WINDOW_MIN = 15;   // deneme penceresi
    private const TH_THRESHOLD = 5;     // bu kadar başarısızlıktan sonra kilit
    private const TH_MAX_LOCK_MIN = 60; // üst sınır kilit süresi

    private function throttleKey(string $ip, string $scope): string
    {
        return hash('sha256', $ip . '|' . $scope);
    }

    private function ensureThrottleTable(): void
    {
        \Depo\Support\Schema::ensureLoginAttempts($this->db);
    }

    /** PDOException "tablo yok" mu? (MySQL 1146 / SQLSTATE 42S02) — self-heal tetikleyicisi. */
    private static function isMissingTable(\PDOException $e): bool
    {
        if ($e->getCode() === '42S02') {
            return true;
        }
        $info = $e->errorInfo ?? null;
        return is_array($info) && isset($info[1]) && (int) $info[1] === 1146;
    }

    private function ensureUserSchema(): void
    {
        \Depo\Support\Schema::ensureUsername($this->db);
    }

    /** Kilitliyse 429 fırlat. */
    private function throttleAssert(string $key): void
    {
        // DDL'i (CREATE TABLE) HER login'de çalıştırma — paylaşımlı MySQL'de metadata
        // kilidiyle login'i saniyelerce takıyordu. Normalde sadece indeksli SELECT;
        // tablo GERÇEKTEN yoksa (migration çalışmamış) bir kez oluştur ve tekrar dene.
        try {
            $row = $this->db->one('SELECT locked_until FROM login_attempts WHERE id = :id', ['id' => $key]);
        } catch (\PDOException $e) {
            if (!$this->db->isMysql() || !self::isMissingTable($e)) {
                throw $e;
            }
            $this->ensureThrottleTable();
            $row = $this->db->one('SELECT locked_until FROM login_attempts WHERE id = :id', ['id' => $key]);
        }
        if ($row !== null && $row['locked_until'] !== null) {
            $until = strtotime((string) $row['locked_until'] . ' UTC');
            if ($until !== false && $until > time()) {
                throw HttpException::tooManyRequests('Çok fazla deneme. ' . ($until - time()) . ' sn sonra tekrar deneyin.');
            }
        }
    }

    /** Başarısız denemeyi kaydet; eşik aşılırsa kilitle (üstel geri çekilme). */
    private function throttleFail(string $key): void
    {
        $now = Time::now();
        $windowStart = (new \DateTimeImmutable('-' . self::TH_WINDOW_MIN . ' minutes', new \DateTimeZone('UTC')))
            ->format('Y-m-d H:i:s.v');

        $row = $this->db->one('SELECT attempts, first_at FROM login_attempts WHERE id = :id', ['id' => $key]);

        if ($row === null) {
            $this->db->run(
                'INSERT INTO login_attempts (id, attempts, first_at, locked_until, updated_at)
                 VALUES (:id, 1, :now, NULL, :now2)',
                ['id' => $key, 'now' => $now, 'now2' => $now]
            );
            return;
        }
        if ((string) $row['first_at'] < $windowStart) {
            // Pencere doldu → sıfırdan başla.
            $this->db->run(
                'UPDATE login_attempts SET attempts = 1, first_at = :now, locked_until = NULL, updated_at = :now2 WHERE id = :id',
                ['now' => $now, 'now2' => $now, 'id' => $key]
            );
            return;
        }

        $attempts = (int) $row['attempts'] + 1;
        $lockedUntil = null;
        if ($attempts >= self::TH_THRESHOLD) {
            $lockMin = min(self::TH_MAX_LOCK_MIN, 2 ** ($attempts - self::TH_THRESHOLD));
            $lockedUntil = (new \DateTimeImmutable("+{$lockMin} minutes", new \DateTimeZone('UTC')))
                ->format('Y-m-d H:i:s.v');
        }
        $this->db->run(
            'UPDATE login_attempts SET attempts = :a, locked_until = :lu, updated_at = :now WHERE id = :id',
            ['a' => $attempts, 'lu' => $lockedUntil, 'now' => $now, 'id' => $key]
        );
    }

    private function throttleReset(string $key): void
    {
        $this->db->run('DELETE FROM login_attempts WHERE id = :id', ['id' => $key]);
    }

    /** Ham token'ın DB'de saklanan biçimi — SHA-256. DB sızarsa oturumlar ele geçmez. */
    public static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    private function createSession(string $userId, string $tenantId): string
    {
        $token = bin2hex(random_bytes(32));   // 64 hex (istemciye ham, DB'ye hash'i gider)
        $now = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $expires = $now->modify("+{$this->sessionTtlDays} days")->format('Y-m-d H:i:s.v');
        // Bu kullanıcının süresi dolmuş oturumlarını temizle (sonsuz büyümeyi önle; SQLite-uyumlu).
        $this->db->run('DELETE FROM sessions WHERE user_id = :u AND expires_at < :now',
            ['u' => $userId, 'now' => $now->format('Y-m-d H:i:s.v')]);
        $this->db->run(
            'INSERT INTO sessions (token, user_id, tenant_id, expires_at) VALUES (:t, :u, :ten, :exp)',
            ['t' => self::hashToken($token), 'u' => $userId, 'ten' => $tenantId, 'exp' => $expires]
        );
        return $token;
    }
}
