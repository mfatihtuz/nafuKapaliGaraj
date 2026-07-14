<?php
declare(strict_types=1);

namespace Depo\Controller;

use Depo\Core\Db;
use Depo\Core\HttpException;
use Depo\Core\Request;
use Depo\Core\Response;
use Depo\Service\AccountService;
use Depo\Support\Context;

/** /api/account/* — kendi hesabını yönetme (her rol). */
final class AccountController
{
    private AccountService $svc;

    public function __construct(private readonly Db $db, private readonly array $config)
    {
        $this->svc = new AccountService($db);
    }

    public function changePassword(Request $req, Response $res, array $params, ?Context $ctx): void
    {
        if ($ctx === null) throw HttpException::unauthorized();
        $cookieName = (string) ($this->config['security']['cookie_name'] ?? 'depo_session');
        $this->svc->changePassword(
            $ctx->userId,
            (string) $req->input('current_password', ''),
            (string) $req->input('new_password', ''),
            $req->bearerOrCookie($cookieName) // mevcut oturum korunur, diğerleri kapanır
        );
        $res->json(['ok' => true]);
    }

    public function updateProfile(Request $req, Response $res, array $params, ?Context $ctx): void
    {
        if ($ctx === null) throw HttpException::unauthorized();
        $data = [];
        foreach (['display_name', 'email', 'username'] as $f) {
            if ($req->input($f) !== null) $data[$f] = $req->input($f);
        }
        $res->json(['user' => $this->svc->updateProfile($ctx->userId, $data)]);
    }
}
