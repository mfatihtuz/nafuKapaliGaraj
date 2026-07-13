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
    public function register(string $email, string $password, string $displayName): array
    {
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
                ['id' => $userId, 'e' => $email, 'h' => password_hash($password, PASSWORD_ARGON2ID), 'n' => $displayName]
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
    public function login(string $email, string $password): array
    {
        $email = mb_strtolower(trim($email));
        $user = $this->db->one(
            'SELECT id, email, password_hash, display_name FROM users WHERE email = :e',
            ['e' => $email]
        );
        // Zamanlama sızıntısını azalt: kullanıcı yoksa da bir hash doğrula.
        if ($user === null) {
            password_verify($password, '$argon2id$v=19$m=65536,t=4,p=1$YWFhYWFhYWFhYWFh$0000000000000000000000000000000000000000000');
            throw HttpException::unauthorized('E-posta veya parola hatalı');
        }
        if (!password_verify($password, (string) $user['password_hash'])) {
            throw HttpException::unauthorized('E-posta veya parola hatalı');
        }

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

        // Parola rehash gerekiyorsa güncelle (argon parametreleri değişirse).
        if (password_needs_rehash((string) $user['password_hash'], PASSWORD_ARGON2ID)) {
            $this->db->run('UPDATE users SET password_hash = :h WHERE id = :id',
                ['h' => password_hash($password, PASSWORD_ARGON2ID), 'id' => $user['id']]);
        }

        $token = $this->createSession((string) $user['id'], (string) $membership['tenant_id']);
        return [
            'token'  => $token,
            'user'   => ['id' => $user['id'], 'email' => $user['email'], 'display_name' => $user['display_name']],
            'tenant' => $tenant,
            'role'   => (string) $membership['role'],
        ];
    }

    public function logout(string $token): void
    {
        $this->db->run('DELETE FROM sessions WHERE token = :t', ['t' => $token]);
    }

    /** @return array<string,mixed> */
    public function me(string $userId, string $tenantId, string $role): array
    {
        $user = $this->db->one('SELECT id, email, display_name FROM users WHERE id = :id', ['id' => $userId]);
        $tenant = $this->db->one('SELECT id, name, locale, settings FROM tenants WHERE id = :id', ['id' => $tenantId]);
        if ($tenant !== null && is_string($tenant['settings'] ?? null)) {
            $tenant['settings'] = json_decode($tenant['settings'], true);
        }
        return ['user' => $user, 'tenant' => $tenant, 'role' => $role];
    }

    private function createSession(string $userId, string $tenantId): string
    {
        $token = bin2hex(random_bytes(32));   // 64 hex
        $expires = (new \DateTimeImmutable("+{$this->sessionTtlDays} days", new \DateTimeZone('UTC')))
            ->format('Y-m-d H:i:s.v');
        $this->db->run(
            'INSERT INTO sessions (token, user_id, tenant_id, expires_at) VALUES (:t, :u, :ten, :exp)',
            ['t' => $token, 'u' => $userId, 'ten' => $tenantId, 'exp' => $expires]
        );
        return $token;
    }
}
