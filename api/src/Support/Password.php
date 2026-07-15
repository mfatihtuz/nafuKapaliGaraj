<?php
declare(strict_types=1);

namespace Depo\Support;

/**
 * Argon2id parametreleri TEK yerde (drift'i önle). OWASP Argon2id minimumu:
 * 19 MiB bellek, 2 tur, 1 iş parçacığı.
 *
 * NEDEN: PHP varsayılanı m=64MB/t=4, paylaşımlı hostingde her login'i ~230ms+
 * CPU + 64MB bellek yapıyordu (eşzamanlı isteklerde bellek baskısı → saniyeler →
 * php-fpm worker'ları dolu → login/eşitleme/F5 hepsi 20sn'ye takılıyordu). Bu
 * parametrelerle ~30ms. 5 deneme/15dk kaba-kuvvet kilidiyle birlikte güvenli.
 */
final class Password
{
    /** @var array{memory_cost:int,time_cost:int,threads:int} */
    public const OPTS = ['memory_cost' => 19456, 'time_cost' => 2, 'threads' => 1];

    /**
     * Geçerli, AYRIŞTIRILABİLİR bir argon2id hash (hiçbir parola eşleşmez).
     * Kullanıcı-bulunamadı yolunda tam-maliyet doğrulama yapıp zamanlama sızıntısını
     * (kullanıcı enumerasyonu) kapatmak için. m,t,p OPTS ile AYNI olmalı — OPTS
     * değişirse bunu da yeniden üret (php -r "echo password_hash('x',PASSWORD_ARGON2ID,OPTS);").
     */
    public const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$d1k0VFVnRTBvU3MuLlFqRQ$GcwilBnMSUOGsL51CFzq42Tbqp1yhOp5i1cw5S3t68s';

    public static function hash(string $plain): string
    {
        return password_hash($plain, PASSWORD_ARGON2ID, self::OPTS);
    }

    /** Depolanan hash mevcut (daha ucuz) parametrelerle uyumsuzsa true — başarılı
     *  login'de kademeli yeniden yazım için. OPTS geçilmezse eski 64MB hash'ler
     *  HER login'de gereksiz rehash tetikler (regresyon) — bu yüzden zorunlu. */
    public static function needsRehash(string $hash): bool
    {
        return password_needs_rehash($hash, PASSWORD_ARGON2ID, self::OPTS);
    }
}
