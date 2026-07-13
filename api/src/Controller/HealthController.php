<?php
declare(strict_types=1);

namespace Depo\Controller;

use Depo\Core\Db;
use Depo\Core\Request;
use Depo\Core\Response;
use Depo\Support\Context;
use Depo\Support\Time;

/** GET /api/health → {ok:true} (SPRINT_PLAN 0.2). */
final class HealthController
{
    public function __construct(
        private readonly Db $db,
        private readonly array $config,
    ) {}

    public function check(Request $req, Response $res, array $params, ?Context $ctx): void
    {
        $dbOk = true;
        try {
            $this->db->one('SELECT 1 AS x');
        } catch (\Throwable) {
            $dbOk = false;
        }
        $res->json([
            'ok'      => true,
            'db'      => $dbOk,
            'time'    => Time::now(),
            'app'     => 'depo',
            'version' => '1.0.0',
        ], $dbOk ? 200 : 503);
    }
}
