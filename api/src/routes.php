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

use Depo\Controller\AccountController;
use Depo\Controller\AiController;
use Depo\Controller\AuthController;
use Depo\Controller\FileController;
use Depo\Controller\HealthController;
use Depo\Controller\OrgController;
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
$router->get('/api/sync/checksum', [SyncController::class, 'checksum']);
$router->post('/api/sync/push', [SyncController::class, 'push']);

// Dosya ekleri (foto/PDF) — ikili yükleme/indirme (FAZ 2.1). Silme sync push ile.
$router->post('/api/files', [FileController::class, 'upload']);
$router->get('/api/files/:id', [FileController::class, 'download']);

// AI tanıma (2.3) + MPN (2.5) — anahtar yoksa nazikçe devre dışı (200 + disabled).
$router->get('/api/ai/status', [AiController::class, 'status']);
$router->post('/api/ai/identify', [AiController::class, 'identify']);
$router->get('/api/lookup/mpn', [AiController::class, 'lookupMpn']);

// Hesap (her rol kendi hesabını yönetir)
$router->post('/api/account/password', [AccountController::class, 'changePassword']);
$router->post('/api/account/profile', [AccountController::class, 'updateProfile']);

// Organizasyon & kullanıcılar (yalnızca owner)
$router->get('/api/org/users', [OrgController::class, 'listUsers']);
$router->post('/api/org/users', [OrgController::class, 'createUser']);
$router->post('/api/org/users/role', [OrgController::class, 'setRole']);
$router->post('/api/org/users/remove', [OrgController::class, 'removeUser']);
$router->post('/api/org/users/password', [OrgController::class, 'resetPassword']);
$router->post('/api/org/rename', [OrgController::class, 'rename']);
$router->post('/api/org/settings', [OrgController::class, 'updateSettings']);
