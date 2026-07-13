<?php
declare(strict_types=1);

namespace Depo\Controller;

use Depo\Core\Db;
use Depo\Core\HttpException;
use Depo\Core\Request;
use Depo\Core\Response;
use Depo\Service\SyncService;
use Depo\Support\Context;

/** /api/sync/* — bootstrap, pull, push (SYNC_PROTOCOL §5). */
final class SyncController
{
    public function __construct(
        private readonly Db $db,
        private readonly array $config,
    ) {}

    public function bootstrap(Request $req, Response $res, array $params, ?Context $ctx): void
    {
        $svc = $this->service($ctx);
        $res->json($svc->bootstrap());
    }

    public function pull(Request $req, Response $res, array $params, ?Context $ctx): void
    {
        $since = (int) $req->query('since', 0);
        $limit = (int) $req->query('limit', 500);
        $svc = $this->service($ctx);
        $res->json($svc->pull($since, $limit));
    }

    public function push(Request $req, Response $res, array $params, ?Context $ctx): void
    {
        if ($ctx === null) {
            throw HttpException::unauthorized();
        }
        if (!$ctx->canWrite()) {
            throw HttpException::forbidden('Yazma yetkiniz yok (viewer)');
        }
        $ops = $req->input('ops', []);
        if (!is_array($ops)) {
            throw HttpException::badRequest('ops bir dizi olmalı');
        }
        if (count($ops) > 1000) {
            throw HttpException::badRequest('Tek push\'ta en fazla 1000 op');
        }
        $svc = $this->service($ctx);
        $res->json($svc->push(array_values($ops)));
    }

    private function service(?Context $ctx): SyncService
    {
        if ($ctx === null) {
            throw HttpException::unauthorized();
        }
        $skew = (int) ($this->config['security']['clock_skew_minutes'] ?? 5);
        return new SyncService($this->db, $ctx->tenantId, $ctx->userId, $skew);
    }
}
