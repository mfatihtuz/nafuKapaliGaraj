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
// Aday yollar index.php'ye GÖRE göreli tutulur; hata mesajlarında yalnızca bu
// göreli etiketler kullanılır — sunucunun mutlak yolu ASLA sızdırılmaz.
$root = __DIR__;
$candidates = [
    // Canlı: public_html/depo_yonetimi/{index.php, private/{config.php,src}}
    ['config' => 'private/config.php',     'src' => 'private/src'],
    // Geliştirme: repo api/public/index.php → api/{config.php, src}
    ['config' => '../config.php',          'src' => '../src'],
    // Geliştirme (secret'sız fallback): config.example.php
    ['config' => '../config.example.php',  'src' => '../src'],
];

$config  = null;
$srcDir  = null;
$checked = []; // tanılama: her başarısız adayda ne bulundu (yalnızca göreli etiket + varlık)
foreach ($candidates as $c) {
    $configAbs = $root . '/' . $c['config'];
    $srcAbs    = $root . '/' . $c['src'];
    $hasConfig = is_file($configAbs);
    $hasSrc    = is_dir($srcAbs);
    if ($hasConfig && $hasSrc) {
        $config = require $configAbs;
        $srcDir = $srcAbs;
        break;
    }
    // Yalnızca varlık bilgisi kaydedilir; dosya içeriği/sırlar OKUNMAZ.
    $checked[] = ['config' => $c['config'], 'config_found' => $hasConfig,
                  'src' => $c['src'], 'src_found' => $hasSrc];
}

if ($config === null) {
    // Kurulum eksik. Deployer'a NE eksik olduğunu (index.php'ye GÖRE göreli) söyle —
    // sunucu mutlak yolu / DB sırları sızdırmadan, eyleme dönük. Canlı yerleşimin
    // (private/) üç durumu ayrı ayrı ele alınır.
    $hasLiveConfig = is_file($root . '/private/config.php');
    $hasLiveSrc    = is_dir($root . '/private/src');
    if (!is_dir($root . '/private')) {
        $message = 'Kurulum tamamlanmamış: "private/" klasörü yok. index.php ile aynı '
                 . 'dizinde "private/" oluşturun; içine "config.php" (config.example.php '
                 . 'dosyasını kopyalayıp veritabanı bilgilerinizi girin) ve "src/" '
                 . '(depodaki api/src içeriği) yükleyin.';
    } elseif ($hasLiveConfig && !$hasLiveSrc) {
        $message = 'Eksik dosya: "private/src". "private/config.php" bulundu ancak uygulama '
                 . 'kaynağı yüklenmemiş. "api/src" klasörünün tamamını "private/src" altına yükleyin.';
    } elseif (!$hasLiveConfig && $hasLiveSrc) {
        $message = 'Eksik dosya: "private/config.php". Uygulama kaynağı ("private/src") bulundu '
                 . 'ancak yapılandırma yok. "config.example.php" dosyasını "private/config.php" '
                 . 'olarak kopyalayıp veritabanı bilgilerinizi girin.';
    } else {
        $message = 'Eksik dosyalar: "private/config.php" ve "private/src". "private/" klasörü '
                 . 'boş görünüyor. "config.example.php" dosyasını "private/config.php" olarak '
                 . 'kopyalayın ve "api/src" içeriğini "private/src" altına yükleyin.';
    }
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    echo json_encode([
        'error'   => 'config_not_found',
        'message' => $message,
        'checked' => $checked, // aranan konumlar (göreli) — yalnızca varlık bilgisi
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
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
