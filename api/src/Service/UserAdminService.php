<?php
declare(strict_types=1);

namespace Depo\Service;

use Depo\Core\Db;
use Depo\Core\HttpException;
use Depo\Core\Uuid;
use Depo\Support\Schema;

/**
 * Organizasyon (tenant) yönetimi — yalnızca owner. Kullanıcı ekleme/rol/çıkarma,
 * organizasyon adı. Roller: owner (tam), member (okuma+hareket), viewer (yalnız gözlem).
 */
final class UserAdminService
{
    private const ROLES = ['owner', 'member', 'viewer'];

    public function __construct(private readonly Db $db) {}

    /** @return list<array<string,mixed>> */
    public function listUsers(string $tenantId): array
    {
        Schema::ensureUsername($this->db);
        return $this->db->all(
            'SELECT u.id, u.email, u.username, u.display_name, tu.role, tu.created_at
               FROM tenant_users tu
               JOIN users u ON u.id = tu.user_id
              WHERE tu.tenant_id = :t
              ORDER BY tu.created_at ASC',
            ['t' => $tenantId]
        );
    }

    /**
     * Yeni kullanıcı oluştur ve organizasyona ekle.
     * @param array<string,mixed> $data {username?, email?, password, display_name, role}
     * @return array<string,mixed>
     */
    public function createUser(string $tenantId, array $data): array
    {
        Schema::ensureUsername($this->db);

        $role = (string) ($data['role'] ?? 'member');
        if (!in_array($role, self::ROLES, true)) {
            throw HttpException::unprocessable('Geçersiz rol');
        }
        $password = (string) ($data['password'] ?? '');
        if (mb_strlen($password) < 8) {
            throw HttpException::unprocessable('Parola en az 8 karakter olmalı');
        }
        $displayName = trim((string) ($data['display_name'] ?? ''));
        if ($displayName === '') {
            throw HttpException::unprocessable('Ad zorunlu');
        }

        $email = null;
        if (($data['email'] ?? '') !== '') {
            $email = mb_strtolower(trim((string) $data['email']));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                throw HttpException::unprocessable('Geçersiz e-posta');
            }
        }
        $username = null;
        if (($data['username'] ?? '') !== '') {
            $username = AccountService::normalizeUsername((string) $data['username']);
        }
        if ($email === null && $username === null) {
            throw HttpException::unprocessable('Kullanıcı adı veya e-posta gerekli');
        }

        if ($email !== null && $this->db->one('SELECT id FROM users WHERE email = :e', ['e' => $email]) !== null) {
            throw HttpException::conflict('Bu e-posta zaten kayıtlı', 'email_taken');
        }
        if ($username !== null && $this->db->one('SELECT id FROM users WHERE username = :u', ['u' => $username]) !== null) {
            throw HttpException::conflict('Bu kullanıcı adı alınmış', 'username_taken');
        }

        return $this->db->transaction(function () use ($tenantId, $email, $username, $password, $displayName, $role) {
            $userId = Uuid::v7();
            $this->db->run(
                'INSERT INTO users (id, email, username, password_hash, display_name)
                 VALUES (:id, :e, :u, :h, :n)',
                ['id' => $userId, 'e' => $email ?? ($userId . '@local.invalid'), 'u' => $username,
                 'h' => password_hash($password, PASSWORD_ARGON2ID), 'n' => $displayName]
            );
            $this->db->run(
                'INSERT INTO tenant_users (tenant_id, user_id, role) VALUES (:t, :u, :r)',
                ['t' => $tenantId, 'u' => $userId, 'r' => $role]
            );
            return ['id' => $userId, 'email' => $email, 'username' => $username, 'display_name' => $displayName, 'role' => $role];
        });
    }

    public function setRole(string $tenantId, string $userId, string $role): void
    {
        if (!in_array($role, self::ROLES, true)) {
            throw HttpException::unprocessable('Geçersiz rol');
        }
        $membership = $this->db->one(
            'SELECT role FROM tenant_users WHERE tenant_id = :t AND user_id = :u',
            ['t' => $tenantId, 'u' => $userId]
        );
        if ($membership === null) {
            throw HttpException::notFound('Kullanıcı bu organizasyonda değil');
        }
        // Son owner'ı düşürme.
        if ($membership['role'] === 'owner' && $role !== 'owner' && $this->ownerCount($tenantId) <= 1) {
            throw HttpException::conflict('Son yönetici rolü değiştirilemez', 'last_owner');
        }
        $this->db->run(
            'UPDATE tenant_users SET role = :r WHERE tenant_id = :t AND user_id = :u',
            ['r' => $role, 't' => $tenantId, 'u' => $userId]
        );
    }

    public function removeUser(string $tenantId, string $actingUserId, string $userId): void
    {
        if ($userId === $actingUserId) {
            throw HttpException::conflict('Kendinizi çıkaramazsınız', 'self_remove');
        }
        $membership = $this->db->one(
            'SELECT role FROM tenant_users WHERE tenant_id = :t AND user_id = :u',
            ['t' => $tenantId, 'u' => $userId]
        );
        if ($membership === null) {
            throw HttpException::notFound();
        }
        if ($membership['role'] === 'owner' && $this->ownerCount($tenantId) <= 1) {
            throw HttpException::conflict('Son yönetici çıkarılamaz', 'last_owner');
        }
        $this->db->run(
            'DELETE FROM tenant_users WHERE tenant_id = :t AND user_id = :u',
            ['t' => $tenantId, 'u' => $userId]
        );
    }

    /** @return array<string,mixed> */
    public function renameOrg(string $tenantId, string $name): array
    {
        $name = trim($name);
        if ($name === '') {
            throw HttpException::unprocessable('Organizasyon adı boş olamaz');
        }
        $this->db->run('UPDATE tenants SET name = :n WHERE id = :id', ['n' => mb_substr($name, 0, 120), 'id' => $tenantId]);
        return ['id' => $tenantId, 'name' => mb_substr($name, 0, 120)];
    }

    /**
     * Organizasyon ayarlarını (etiket ızgarası, QR taban URL'i, varsayılan sayım modu) birleştir.
     * @param array<string,mixed> $settings
     * @return array<string,mixed>
     */
    public function updateSettings(string $tenantId, array $settings): array
    {
        $row = $this->db->one('SELECT settings FROM tenants WHERE id = :id', ['id' => $tenantId]);
        $current = [];
        if ($row !== null && is_string($row['settings'] ?? null)) {
            $decoded = json_decode((string) $row['settings'], true);
            if (is_array($decoded)) $current = $decoded;
        }
        $merged = array_merge($current, $settings);
        $this->db->run('UPDATE tenants SET settings = :s WHERE id = :id',
            ['s' => json_encode($merged, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 'id' => $tenantId]);
        return $merged;
    }

    private function ownerCount(string $tenantId): int
    {
        $row = $this->db->one(
            "SELECT COUNT(*) AS c FROM tenant_users WHERE tenant_id = :t AND role = 'owner'",
            ['t' => $tenantId]
        );
        return (int) ($row['c'] ?? 0);
    }
}
