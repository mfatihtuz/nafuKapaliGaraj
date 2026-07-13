<?php
declare(strict_types=1);

namespace Depo\Core;

/**
 * Minimal PSR-4 autoloader — Composer'sız.
 * `Depo\Foo\Bar` → `<src>/Foo/Bar.php`
 */
final class Autoloader
{
    public static function register(string $srcDir): void
    {
        spl_autoload_register(static function (string $class) use ($srcDir): void {
            $prefix = 'Depo\\';
            if (!str_starts_with($class, $prefix)) {
                return;
            }
            $relative = substr($class, strlen($prefix));
            $path = $srcDir . '/' . str_replace('\\', '/', $relative) . '.php';
            if (is_file($path)) {
                require $path;
            }
        });
    }
}
