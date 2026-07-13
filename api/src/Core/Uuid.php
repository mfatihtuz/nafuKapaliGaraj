<?php
declare(strict_types=1);

namespace Depo\Core;

/**
 * UUIDv7 üretimi ve doğrulaması (RFC 9562).
 * Zaman-sıralı → MySQL B-tree index parçalanması az (SYNC_PROTOCOL §3).
 * ID'ler normalde istemcide üretilir; sunucu yalnızca doğrular.
 */
final class Uuid
{
    public static function v7(): string
    {
        $ts   = (int) floor(microtime(true) * 1000);   // 48-bit ms
        $data = random_bytes(16);

        // İlk 48 bit: zaman damgası (big-endian)
        $data[0] = chr(($ts >> 40) & 0xff);
        $data[1] = chr(($ts >> 32) & 0xff);
        $data[2] = chr(($ts >> 24) & 0xff);
        $data[3] = chr(($ts >> 16) & 0xff);
        $data[4] = chr(($ts >> 8) & 0xff);
        $data[5] = chr($ts & 0xff);
        // Sürüm 7
        $data[6] = chr((ord($data[6]) & 0x0f) | 0x70);
        // Varyant 10xx
        $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);

        $hex = bin2hex($data);
        return sprintf(
            '%s-%s-%s-%s-%s',
            substr($hex, 0, 8),
            substr($hex, 8, 4),
            substr($hex, 12, 4),
            substr($hex, 16, 4),
            substr($hex, 20, 12)
        );
    }

    /** Katı UUIDv7 doğrulaması: istemci geçersiz ID gönderirse reddet (SYNC_PROTOCOL §3). */
    public static function isV7(string $id): bool
    {
        return (bool) preg_match(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',
            $id
        );
    }

    /** Herhangi bir UUID biçimi (v1-8) — actor_id gibi dış kaynaklı alanlar için. */
    public static function isValid(string $id): bool
    {
        return (bool) preg_match(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i',
            $id
        );
    }
}
