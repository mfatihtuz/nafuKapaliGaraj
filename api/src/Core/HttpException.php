<?php
declare(strict_types=1);

namespace Depo\Core;

/**
 * Kontrollü HTTP hataları. index.php tek noktada yakalar, JSON döndürür.
 * `die()`/`exit()` kullanılmaz (CLAUDE.md §4).
 */
class HttpException extends \RuntimeException
{
    public function __construct(
        private readonly int $statusCode,
        private readonly string $errorCode,
        string $message = ''
    ) {
        parent::__construct($message !== '' ? $message : $errorCode);
    }

    public function getStatusCode(): int { return $this->statusCode; }
    public function getErrorCode(): string { return $this->errorCode; }

    public static function badRequest(string $message = 'Geçersiz istek', string $code = 'bad_request'): self
    {
        return new self(400, $code, $message);
    }
    public static function unauthorized(string $message = 'Kimlik doğrulama gerekli'): self
    {
        return new self(401, 'unauthorized', $message);
    }
    public static function forbidden(string $message = 'Yetkiniz yok'): self
    {
        return new self(403, 'forbidden', $message);
    }
    /** Tenant izolasyonu: varlık başka tenant'a aitse 404 (varlığı sızdırma — ARCHITECTURE §3). */
    public static function notFound(string $message = 'Bulunamadı'): self
    {
        return new self(404, 'not_found', $message);
    }
    public static function conflict(string $message = 'Çakışma', string $code = 'conflict'): self
    {
        return new self(409, $code, $message);
    }
    public static function unprocessable(string $message = 'İşlenemeyen veri'): self
    {
        return new self(422, 'unprocessable', $message);
    }
    public static function tooManyRequests(string $message = 'Çok fazla deneme'): self
    {
        return new self(429, 'too_many_requests', $message);
    }
}
