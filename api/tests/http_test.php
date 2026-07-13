<?php
declare(strict_types=1);

/**
 * HTTP katmanı testi: Router + AuthMiddleware + controller'lar uçtan uca.
 * Çalıştır:  php api/tests/http_test.php
 */

require __DIR__ . '/bootstrap.php';

// CLI'de header() uyarılarını sustur (gövde yakalanıyor, başlık önemsiz).
error_reporting(E_ALL & ~E_WARNING);
ini_set('display_errors', '0');

use Depo\Core\Db;
use Depo\Core\Request;
use Depo\Core\Response;
use Depo\Core\Router;
use Depo\Core\Uuid;
use Depo\Service\AuthService;

$config = [
    'app'      => ['base_path' => '', 'env' => 'development'],
    'security' => ['cookie_name' => 'depo_session', 'session_ttl_days' => 90,
                   'cookie_secure' => false, 'cookie_samesite' => 'Lax', 'clock_skew_minutes' => 5],
    'db'       => [],
];

/** Bir isteği Router'dan geçirir, JSON gövdeyi döndürür. */
function dispatch(Db $db, array $config, string $method, string $path, array $body = [], array $cookies = []): array
{
    $req = Request::make($method, $path, [], $body, $cookies);
    // Query string'i path'ten ayıkla (pull için)
    if (str_contains($path, '?')) {
        [$p, $q] = explode('?', $path, 2);
        parse_str($q, $query);
        $req = Request::make($method, $p, $query, $body, $cookies);
    }
    $res = new Response();
    $router = new Router($req, $res, $db, $config);
    require __DIR__ . '/../src/routes.php';

    ob_start();
    try {
        $router->dispatch();
    } catch (\Depo\Core\HttpException $e) {
        $out = json_encode(['error' => $e->getErrorCode(), 'message' => $e->getMessage(), '__status' => $e->getStatusCode()]);
        ob_end_clean();
        return json_decode($out, true);
    }
    $body = ob_get_clean() ?: '{}';
    return json_decode($body, true) ?? [];
}

function tokenFor(Db $db, string $userId): string
{
    $row = $db->one('SELECT token FROM sessions WHERE user_id = :u ORDER BY created_at DESC LIMIT 1', ['u' => $userId]);
    return (string) ($row['token'] ?? '');
}

// ===========================================================================

fwrite(STDOUT, "HTTP — sağlık, kimlik, korumalı rotalar\n");

[$db] = make_test_db();

// 1. Health (auth yok)
$h = dispatch($db, $config, 'GET', '/api/health');
eq($h['ok'] ?? null, true, 'GET /api/health → ok:true');

// 2. Register (controller üzerinden)
$reg = dispatch($db, $config, 'POST', '/api/auth/register',
    ['email' => 'fatih@depo.local', 'password' => 'parola1234', 'display_name' => 'Fatih']);
eq($reg['role'] ?? null, 'owner', 'register → owner rolü');
check(isset($reg['tenant']['id']), 'register → tenant oluştu');

$userId = (string) ($db->one('SELECT id FROM users WHERE email = :e', ['e' => 'fatih@depo.local'])['id'] ?? '');
$cookieName = 'depo_session';

// 3. Login
$login = dispatch($db, $config, 'POST', '/api/auth/login',
    ['email' => 'fatih@depo.local', 'password' => 'parola1234']);
eq($login['user']['email'] ?? null, 'fatih@depo.local', 'login → doğru kullanıcı');
$token = tokenFor($db, $userId);
check(strlen($token) === 64, 'login → 64 karakterlik opak token oluştu');

// 4. Yanlış parola
$bad = dispatch($db, $config, 'POST', '/api/auth/login',
    ['email' => 'fatih@depo.local', 'password' => 'yanlis']);
eq($bad['error'] ?? null, 'unauthorized', 'yanlış parola → unauthorized');

// 5. Korumalı rota, token YOK → 401
$noAuth = dispatch($db, $config, 'GET', '/api/sync/bootstrap');
eq($noAuth['error'] ?? null, 'unauthorized', 'token yok → 401');

// 6. Korumalı rota, token ile → bootstrap
$boot = dispatch($db, $config, 'GET', '/api/sync/bootstrap', [], [$cookieName => $token]);
check(isset($boot['cursor']), 'bootstrap → cursor döndü');
check(isset($boot['tenant']['id']), 'bootstrap → tenant döndü');

// 7. me
$me = dispatch($db, $config, 'GET', '/api/auth/me', [], [$cookieName => $token]);
eq($me['role'] ?? null, 'owner', 'me → owner');

// 8. Push: location + part + stock_move
$partId = Uuid::v7();
$locId = Uuid::v7();
$when = (new DateTimeImmutable('@1752000000'))->format('Y-m-d\TH:i:s.v\Z');
$ops = [
    ['op_id' => Uuid::v7(), 'type' => 'upsert', 'entity' => 'location',
     'data' => ['id' => $locId, 'code' => 'S1-01', 'type' => 'drawer', 'path' => 'GARAJ/S1/S1-01', 'updated_at' => $when]],
    ['op_id' => Uuid::v7(), 'type' => 'upsert', 'entity' => 'part',
     'data' => ['id' => $partId, 'sku' => 'R-0805-1K', 'name' => '1K', 'count_mode' => 'exact', 'updated_at' => $when]],
    ['op_id' => Uuid::v7(), 'type' => 'stock_move',
     'data' => ['id' => Uuid::v7(), 'part_id' => $partId, 'location_id' => $locId, 'delta' => 25, 'reason' => 'purchase', 'created_at' => $when]],
];
$push = dispatch($db, $config, 'POST', '/api/sync/push', ['ops' => $ops], [$cookieName => $token]);
eq(count($push['applied'] ?? []), 3, 'push → 3 op applied');

// 9. Pull sonrası değişiklikler görünür
$pull = dispatch($db, $config, 'GET', '/api/sync/pull?since=0&limit=500', [], [$cookieName => $token]);
check(count($pull['changes'] ?? []) >= 3, 'pull → değişiklikler döndü');

// 10. Viewer push edemez
$viewerUser = Uuid::v7();
$db->run('INSERT INTO users (id, email, password_hash, display_name) VALUES (:i,:e,:h,:n)',
    ['i' => $viewerUser, 'e' => 'v@depo.local', 'h' => 'x', 'n' => 'Viewer']);
$tenantId = (string) ($db->one('SELECT tenant_id FROM tenant_users WHERE user_id = :u', ['u' => $userId])['tenant_id']);
$db->run('INSERT INTO tenant_users (tenant_id, user_id, role) VALUES (:t,:u,:r)',
    ['t' => $tenantId, 'u' => $viewerUser, 'r' => 'viewer']);
$vToken = bin2hex(random_bytes(32));
$db->run('INSERT INTO sessions (token, user_id, tenant_id, expires_at) VALUES (:t,:u,:ten,:e)',
    ['t' => $vToken, 'u' => $viewerUser, 'ten' => $tenantId, 'e' => (new DateTimeImmutable('+1 day'))->format('Y-m-d H:i:s.v')]);
$vpush = dispatch($db, $config, 'POST', '/api/sync/push', ['ops' => $ops], [$cookieName => $vToken]);
eq($vpush['error'] ?? null, 'forbidden', 'viewer push → forbidden');

exit(test_summary());
