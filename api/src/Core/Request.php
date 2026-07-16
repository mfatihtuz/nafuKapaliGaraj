<?php
declare(strict_types=1);

namespace Depo\Core;

/**
 * Gelen HTTP isteği. base_path uygulamanın alt yolundan arındırılmış rota verir.
 */
final class Request
{
    /**
     * @param array<string,mixed> $query
     * @param array<string,mixed> $body   JSON gövde (decode edilmiş)
     * @param array<string,string> $cookies
     * @param array<string,string> $headers
     */
    private function __construct(
        public readonly string $method,
        public readonly string $path,      // base_path çıkarılmış: '/api/health'
        public readonly array $query,
        public readonly array $body,
        public readonly array $cookies,
        public readonly array $headers,
        public readonly string $ip = '0.0.0.0',
    ) {}

    public static function fromGlobals(string $basePath = ''): self
    {
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

        $uri  = $_SERVER['REQUEST_URI'] ?? '/';
        $path = parse_url($uri, PHP_URL_PATH) ?: '/';
        $path = rawurldecode($path);

        // base_path önekini çıkar ('/depo_yonetimi/api/x' → '/api/x')
        if ($basePath !== '' && str_starts_with($path, $basePath)) {
            $path = substr($path, strlen($basePath));
        }
        if ($path === '' || $path[0] !== '/') {
            $path = '/' . $path;
        }
        $path = rtrim($path, '/');
        if ($path === '') {
            $path = '/';
        }

        // JSON gövde
        $body = [];
        $ctype = $_SERVER['CONTENT_TYPE'] ?? '';
        if (str_contains($ctype, 'application/json')) {
            $raw = file_get_contents('php://input') ?: '';
            if ($raw !== '') {
                $decoded = json_decode($raw, true);
                if (is_array($decoded)) {
                    $body = $decoded;
                }
            }
        } elseif (!empty($_POST)) {
            $body = $_POST;
        }

        // Başlıklar (getallheaders yoksa $_SERVER'dan türet)
        $headers = [];
        foreach ($_SERVER as $k => $v) {
            if (str_starts_with($k, 'HTTP_')) {
                $name = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($k, 5)))));
                $headers[$name] = (string) $v;
            }
        }

        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');

        return new self($method, $path, $_GET, $body, $_COOKIE, $headers, $ip);
    }

    /** Test amaçlı elle inşa. */
    public static function make(string $method, string $path, array $query = [], array $body = [], array $cookies = [], string $ip = '0.0.0.0'): self
    {
        return new self(strtoupper($method), $path, $query, $body, $cookies, [], $ip);
    }

    public function query(string $key, mixed $default = null): mixed
    {
        return $this->query[$key] ?? $default;
    }

    public function input(string $key, mixed $default = null): mixed
    {
        return $this->body[$key] ?? $default;
    }

    public function cookie(string $key): ?string
    {
        return $this->cookies[$key] ?? null;
    }

    /**
     * Multipart yükleme dosyası ($_FILES[$key]). Yalnızca başarılı yüklemede döner.
     * @return array{name:string,tmp_name:string,size:int,error:int,type:string}|null
     */
    public function file(string $key): ?array
    {
        $f = $_FILES[$key] ?? null;
        if (!is_array($f) || (int) ($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            return null;
        }
        return [
            'name'     => (string) ($f['name'] ?? 'dosya'),
            'tmp_name' => (string) ($f['tmp_name'] ?? ''),
            'size'     => (int) ($f['size'] ?? 0),
            'error'    => (int) ($f['error'] ?? 0),
            'type'     => (string) ($f['type'] ?? ''),
        ];
    }

    public function header(string $name): ?string
    {
        return $this->headers[$name] ?? null;
    }

    public function bearerOrCookie(string $cookieName): ?string
    {
        $auth = $this->headers['Authorization'] ?? '';
        if (str_starts_with($auth, 'Bearer ')) {
            return trim(substr($auth, 7));
        }
        return $this->cookie($cookieName);
    }
}
