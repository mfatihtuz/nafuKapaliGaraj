<?php
declare(strict_types=1);

namespace Depo\Core;

use Depo\Middleware\AuthMiddleware;
use Depo\Support\Context;

/**
 * Basit rota eşleştirici. `:param` yer tutucularını destekler.
 * Kimlik doğrulama gereken rotalar için Context çözer ve controller'a geçer.
 */
final class Router
{
    /** @var list<array{method:string,regex:string,params:list<string>,handler:array{0:class-string,1:string},auth:bool}> */
    private array $routes = [];

    public function __construct(
        private readonly Request $request,
        private readonly Response $response,
        private readonly Db $db,
        private readonly array $config,
    ) {}

    /** @param array{0:class-string,1:string} $handler */
    public function get(string $pattern, array $handler, bool $auth = true): void  { $this->add('GET', $pattern, $handler, $auth); }
    public function post(string $pattern, array $handler, bool $auth = true): void { $this->add('POST', $pattern, $handler, $auth); }
    public function put(string $pattern, array $handler, bool $auth = true): void  { $this->add('PUT', $pattern, $handler, $auth); }
    public function delete(string $pattern, array $handler, bool $auth = true): void { $this->add('DELETE', $pattern, $handler, $auth); }

    /** @param array{0:class-string,1:string} $handler */
    private function add(string $method, string $pattern, array $handler, bool $auth): void
    {
        $params = [];
        $regex = preg_replace_callback('#:([a-zA-Z_][a-zA-Z0-9_]*)#', function ($m) use (&$params) {
            $params[] = $m[1];
            return '([^/]+)';
        }, $pattern);
        $this->routes[] = [
            'method'  => $method,
            'regex'   => '#^' . $regex . '$#',
            'params'  => $params,
            'handler' => $handler,
            'auth'    => $auth,
        ];
    }

    public function dispatch(): void
    {
        $pathMatched = false;

        foreach ($this->routes as $route) {
            if (!preg_match($route['regex'], $this->request->path, $matches)) {
                continue;
            }
            $pathMatched = true;
            if ($route['method'] !== $this->request->method) {
                continue;
            }

            // Yol parametrelerini eşle
            $params = [];
            foreach ($route['params'] as $i => $name) {
                $params[$name] = rawurldecode($matches[$i + 1]);
            }

            $ctx = null;
            if ($route['auth']) {
                $ctx = $this->authMiddleware()->resolve($this->request);
            }

            [$class, $action] = $route['handler'];
            /** @var object $controller */
            $controller = new $class($this->db, $this->config);
            $controller->$action($this->request, $this->response, $params, $ctx);
            return;
        }

        if ($pathMatched) {
            throw new HttpException(405, 'method_not_allowed', 'Bu yol için metod desteklenmiyor');
        }
        throw HttpException::notFound('Uç nokta yok');
    }

    private function authMiddleware(): AuthMiddleware
    {
        return new AuthMiddleware($this->db, $this->config['security']['cookie_name'] ?? 'depo_session');
    }
}
