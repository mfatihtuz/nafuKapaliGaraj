<?php
declare(strict_types=1);

/**
 * Rota tablosu. index.php içinde $router hazırken require edilir.
 *
 * API yüzeyi (ARCHITECTURE §4): yalnızca 3 sync uç noktası tüm CRUD'u karşılar.
 * Ayrı POST /parts, PUT /parts/:id YOK — her yazma outbox → push'tan geçer.
 *
 * @var \Depo\Core\Router $router
 */

use Depo\Controller\AuthController;
use Depo\Controller\HealthController;
use Depo\Controller\SyncController;

// --- Public (auth gerektirmez) ---
$router->get('/api/health', [HealthController::class, 'check'], auth: false);
$router->post('/api/auth/register', [AuthController::class, 'register'], auth: false);
$router->post('/api/auth/login', [AuthController::class, 'login'], auth: false);
$router->post('/api/auth/logout', [AuthController::class, 'logout'], auth: false);

// --- Korumalı ---
$router->get('/api/auth/me', [AuthController::class, 'me']);
$router->get('/api/sync/bootstrap', [SyncController::class, 'bootstrap']);
$router->get('/api/sync/pull', [SyncController::class, 'pull']);
$router->post('/api/sync/push', [SyncController::class, 'push']);
