<?php
declare(strict_types=1);

namespace Depo\Controller;

use Depo\Core\Db;
use Depo\Core\HttpException;
use Depo\Core\Request;
use Depo\Core\Response;
use Depo\Service\AuthService;
use Depo\Support\Context;

/** /api/auth/* — register, login, logout, me. */
final class AuthController
{
    private AuthService $auth;

    public function __construct(
        private readonly Db $db,
        private readonly array $config,
    ) {
        $this->auth = new AuthService($db, (int) ($config['security']['session_ttl_days'] ?? 90));
    }

    public function register(Request $req, Response $res, array $params, ?Context $ctx): void
    {
        $result = $this->auth->register(
            (string) $req->input('email', ''),
            (string) $req->input('password', ''),
            (string) $req->input('display_name', '')
        );
        $this->issueCookie($res, $result['token']);
        $res->json($this->publicPayload($result), 201);
    }

    public function login(Request $req, Response $res, array $params, ?Context $ctx): void
    {
        $result = $this->auth->login(
            (string) $req->input('email', ''),
            (string) $req->input('password', '')
        );
        $this->issueCookie($res, $result['token']);
        $res->json($this->publicPayload($result), 200);
    }

    public function logout(Request $req, Response $res, array $params, ?Context $ctx): void
    {
        // Cookie veya Authorization: Bearer ile gelen oturumu sunucuda geçersiz kıl.
        $token = $req->bearerOrCookie($this->cookieName());
        if ($token !== null && $token !== '') {
            $this->auth->logout($token);
        }
        $res->clearCookie($this->cookieName(), $this->cookiePath());
        $res->json(['ok' => true]);
    }

    public function me(Request $req, Response $res, array $params, ?Context $ctx): void
    {
        if ($ctx === null) {
            throw HttpException::unauthorized();
        }
        $res->json($this->auth->me($ctx->userId, $ctx->tenantId, $ctx->role));
    }

    // --- yardımcılar --------------------------------------------------------

    /** @param array{token:string,user:array,tenant:mixed,role:string} $result */
    private function publicPayload(array $result): array
    {
        // token httpOnly cookie'de; gövdeye koymuyoruz (XSS'te çalınamasın).
        return ['user' => $result['user'], 'tenant' => $result['tenant'], 'role' => $result['role']];
    }

    private function issueCookie(Response $res, string $token): void
    {
        $sec = $this->config['security'] ?? [];
        $res->setCookie(
            $this->cookieName(),
            $token,
            60 * 60 * 24 * (int) ($sec['session_ttl_days'] ?? 90),
            $this->cookiePath(),
            (bool) ($sec['cookie_secure'] ?? true),
            (string) ($sec['cookie_samesite'] ?? 'Lax'),
        );
    }

    private function cookieName(): string
    {
        return (string) ($this->config['security']['cookie_name'] ?? 'depo_session');
    }

    private function cookiePath(): string
    {
        $base = (string) ($this->config['app']['base_path'] ?? '');
        return $base !== '' ? $base : '/';
    }
}
