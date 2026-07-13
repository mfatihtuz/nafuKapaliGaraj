<?php
declare(strict_types=1);

namespace Depo\Controller;

use Depo\Core\Db;
use Depo\Core\HttpException;
use Depo\Core\Request;
use Depo\Core\Response;
use Depo\Service\UserAdminService;
use Depo\Support\Context;

/** /api/org/* — organizasyon ve kullanıcı yönetimi (yalnızca owner). */
final class OrgController
{
    private UserAdminService $svc;

    public function __construct(private readonly Db $db, private readonly array $config)
    {
        $this->svc = new UserAdminService($db);
    }

    private function requireOwner(?Context $ctx): Context
    {
        if ($ctx === null) throw HttpException::unauthorized();
        if (!$ctx->isOwner()) throw HttpException::forbidden('Bu işlem için yönetici olmalısınız');
        return $ctx;
    }

    public function listUsers(Request $req, Response $res, array $params, ?Context $ctx): void
    {
        $ctx = $this->requireOwner($ctx);
        $res->json(['users' => $this->svc->listUsers($ctx->tenantId)]);
    }

    public function createUser(Request $req, Response $res, array $params, ?Context $ctx): void
    {
        $ctx = $this->requireOwner($ctx);
        $user = $this->svc->createUser($ctx->tenantId, [
            'username'     => $req->input('username', ''),
            'email'        => $req->input('email', ''),
            'password'     => $req->input('password', ''),
            'display_name' => $req->input('display_name', ''),
            'role'         => $req->input('role', 'member'),
        ]);
        $res->json(['user' => $user], 201);
    }

    public function setRole(Request $req, Response $res, array $params, ?Context $ctx): void
    {
        $ctx = $this->requireOwner($ctx);
        $this->svc->setRole($ctx->tenantId, (string) $req->input('user_id', ''), (string) $req->input('role', ''));
        $res->json(['ok' => true]);
    }

    public function removeUser(Request $req, Response $res, array $params, ?Context $ctx): void
    {
        $ctx = $this->requireOwner($ctx);
        $this->svc->removeUser($ctx->tenantId, $ctx->userId, (string) $req->input('user_id', ''));
        $res->json(['ok' => true]);
    }

    public function rename(Request $req, Response $res, array $params, ?Context $ctx): void
    {
        $ctx = $this->requireOwner($ctx);
        $res->json(['tenant' => $this->svc->renameOrg($ctx->tenantId, (string) $req->input('name', ''))]);
    }

    public function updateSettings(Request $req, Response $res, array $params, ?Context $ctx): void
    {
        $ctx = $this->requireOwner($ctx);
        $settings = $req->input('settings', []);
        if (!is_array($settings)) throw HttpException::badRequest('settings nesne olmalı');
        $res->json(['settings' => $this->svc->updateSettings($ctx->tenantId, $settings)]);
    }
}
