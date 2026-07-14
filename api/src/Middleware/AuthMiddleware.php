<?php
declare(strict_types=1);

namespace Depo\Middleware;

use Depo\Core\Db;
use Depo\Core\HttpException;
use Depo\Core\Request;
use Depo\Support\Context;

/**
 * Opak session token → Context çözümü.
 * Token cookie'de (httpOnly) veya Authorization: Bearer başlığında olabilir.
 */
final class AuthMiddleware
{
    public function __construct(
        private readonly Db $db,
        private readonly string $cookieName,
    ) {}

    public function resolve(Request $request): Context
    {
        $token = $request->bearerOrCookie($this->cookieName);
        if ($token === null || $token === '' || strlen($token) !== 64) {
            throw HttpException::unauthorized();
        }
        // DB'de token'ın HASH'i saklanır (düz metin değil) — sızıntıda oturumlar korunur.
        $hashed = \Depo\Service\AuthService::hashToken($token);

        $row = $this->db->one(
            'SELECT s.user_id, s.tenant_id, s.expires_at, tu.role
               FROM sessions s
               JOIN tenant_users tu
                 ON tu.tenant_id = s.tenant_id AND tu.user_id = s.user_id
              WHERE s.token = :token',
            ['token' => $hashed]
        );

        if ($row === null) {
            throw HttpException::unauthorized('Oturum geçersiz');
        }
        if (strtotime((string) $row['expires_at']) < time()) {
            $this->db->run('DELETE FROM sessions WHERE token = :token', ['token' => $token]);
            throw HttpException::unauthorized('Oturum süresi doldu');
        }

        return new Context(
            userId: (string) $row['user_id'],
            tenantId: (string) $row['tenant_id'],
            role: (string) $row['role'],
        );
    }
}
