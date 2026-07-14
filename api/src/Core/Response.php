<?php
declare(strict_types=1);

namespace Depo\Core;

/**
 * JSON yanıt üreticisi + cookie yönetimi.
 */
final class Response
{
    private bool $sent = false;

    /** @param array<string,mixed>|list<mixed> $data */
    public function json(array $data, int $status = 200): void
    {
        if ($this->sent) {
            return;
        }
        $this->sent = true;
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        // Geçersiz UTF-8 encode'u false yapıp 200+boş gövde üretmesin: bozuk baytları
        // U+FFFD ile değiştir; yine de başarısızsa açık 500 dön.
        $body = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
        if ($body === false) {
            http_response_code(500);
            $body = '{"error":"encode_failed","message":"Yanıt kodlanamadı"}';
        }
        echo $body;
    }

    public function noContent(int $status = 204): void
    {
        if ($this->sent) {
            return;
        }
        $this->sent = true;
        http_response_code($status);
    }

    /**
     * httpOnly opak session cookie'si (ARCHITECTURE §3).
     */
    public function setCookie(
        string $name,
        string $value,
        int $maxAgeSeconds,
        string $path = '/',
        bool $secure = true,
        string $sameSite = 'Lax'
    ): void {
        setcookie($name, $value, [
            'expires'  => $maxAgeSeconds > 0 ? time() + $maxAgeSeconds : 1,
            'path'     => $path,
            'secure'   => $secure,
            'httponly' => true,
            'samesite' => $sameSite,
        ]);
    }

    public function clearCookie(string $name, string $path = '/'): void
    {
        $this->setCookie($name, '', -1, $path);
    }
}
