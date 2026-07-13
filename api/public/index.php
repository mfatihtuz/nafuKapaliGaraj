<?php
declare(strict_types=1);

/**
 * DEPO — Front controller (tek giriş noktası).
 *
 * Tüm /api/* istekleri buraya .htaccess ile yönlendirilir.
 * Statik dosyalar (assets/…) doğrudan sunulur; kalan her şey SPA fallback'i
 * için index.html'e düşer (bkz. .htaccess).
 */

use Depo\Core\Autoloader;
use Depo\Core\Db;
use Depo\Core\Request;
use Depo\Core\Response;
use Depo\Core\Router;
use Depo\Core\HttpException;

// --- config + kaynak konumu (dev/prod ikisinde de çalışır) ------------------
$candidates = [
    // Canlı: public_html/depo_yonetimi/{index.php, private/{config.php,src}}
    ['config' => __DIR__ . '/private/config.php',        'src' => __DIR__ . '/private/src'],
    // Geliştirme: repo api/public/index.php → api/{config.php, src}
    ['config' => dirname(__DIR__) . '/config.php',        'src' => dirname(__DIR__) . '/src'],
    // Geliştirme (secret'sız fallback): config.example.php
    ['config' => dirname(__DIR__) . '/config.example.php','src' => dirname(__DIR__) . '/src'],
];

$config = null;
$srcDir = null;
foreach ($candidates as $c) {
    if (is_file($c['config']) && is_dir($c['src'])) {
        $config = require $c['config'];
        $srcDir = $c['src'];
        break;
    }
}

if ($config === null) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'config_not_found', 'message' => 'config.php bulunamadı']);
    exit;
}

require $srcDir . '/Core/Autoloader.php';
Autoloader::register($srcDir);

// --- global ayarlar ---------------------------------------------------------
date_default_timezone_set('UTC');
mb_internal_encoding('UTF-8');

$response = new Response();

try {
    $request = Request::fromGlobals($config['app']['base_path'] ?? '');
    $db      = new Db($config['db']);

    $router  = new Router($request, $response, $db, $config);
    require $srcDir . '/routes.php';   // rota tanımları

    $router->dispatch();
} catch (HttpException $e) {
    $response->json(['error' => $e->getErrorCode(), 'message' => $e->getMessage()], $e->getStatusCode());
} catch (\Throwable $e) {
    $debug = (($config['app']['env'] ?? 'production') !== 'production');
    $payload = ['error' => 'internal_error', 'message' => 'Sunucu hatası'];
    if ($debug) {
        $payload['detail'] = $e->getMessage();
        $payload['trace']  = explode("\n", $e->getTraceAsString());
    }
    error_log('[DEPO] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    $response->json($payload, 500);
}
