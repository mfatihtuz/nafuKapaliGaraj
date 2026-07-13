<?php
declare(strict_types=1);

namespace Depo\Support;

/**
 * UTC zaman yardımcıları. Her şey DATETIME(3) (ms hassasiyet), UTC (CLAUDE.md §4).
 */
final class Time
{
    /** Şu an — MySQL DATETIME(3) biçimi. */
    public static function now(): string
    {
        return (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format('Y-m-d H:i:s.v');
    }

    /**
     * İstemciden gelen ISO8601 (ör. '2026-07-13T09:14:22.412Z') → MySQL DATETIME(3).
     * Geçersizse şimdiye düşer.
     */
    public static function isoToMysql(?string $iso): string
    {
        if ($iso === null || $iso === '') {
            return self::now();
        }
        try {
            $dt = new \DateTimeImmutable($iso);
            return $dt->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s.v');
        } catch (\Throwable) {
            return self::now();
        }
    }

    /**
     * LWW için istemci saatini sunucu saatiyle sınırla (SYNC_PROTOCOL §7):
     * updated_at = min(client_updated_at, now() + skew).
     * Gelecekten gelen kayıtların diğer her şeyi ezmesini engeller.
     */
    public static function clampUpdatedAt(?string $iso, int $skewMinutes): string
    {
        $client = self::isoToMysql($iso);
        $ceiling = (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))
            ->modify("+{$skewMinutes} minutes")
            ->format('Y-m-d H:i:s.v');
        return $client > $ceiling ? $ceiling : $client;
    }

    /** İki MySQL datetime string'ini karşılaştır (a > b). */
    public static function gt(string $a, string $b): bool
    {
        return $a > $b;
    }
}
