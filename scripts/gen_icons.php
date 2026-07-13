<?php
declare(strict_types=1);

/**
 * PWA ikon üreteci — GD ile marka ikonu (lacivert zemin + amber çekmece çubukları).
 * Çalıştır:  php scripts/gen_icons.php
 * Çıktı:     web/public/icons/*.png  +  web/public/apple-touch-icon.png
 */

$outDir = __DIR__ . '/../web/public/icons';
@mkdir($outDir, 0755, true);

/** Tek bir ikon üretir. $pad: kenar boşluğu oranı (maskable için büyük). */
function makeIcon(int $size, float $pad, string $path): void
{
    $img = imagecreatetruecolor($size, $size);
    imagesavealpha($img, true);

    $navy = imagecolorallocate($img, 0x14, 0x21, 0x3d);   // #14213d
    $amber = imagecolorallocate($img, 0xfc, 0xa3, 0x11);  // #fca311

    imagefilledrectangle($img, 0, 0, $size, $size, $navy);

    // 3 çekmece çubuğu
    $inner = $size * (1 - 2 * $pad);
    $left = (int) ($size * $pad);
    $barW = (int) $inner;
    $barH = (int) ($size * 0.14);
    $gap = (int) ($size * 0.07);
    $totalH = $barH * 3 + $gap * 2;
    $top = (int) (($size - $totalH) / 2);

    for ($i = 0; $i < 3; $i++) {
        $y = $top + $i * ($barH + $gap);
        roundedRect($img, $left, $y, $left + $barW, $y + $barH, (int) ($barH * 0.35), $amber);
        // kulp (küçük lacivert daire)
        $cx = (int) ($left + $barW / 2);
        $cy = (int) ($y + $barH / 2);
        $r = max(2, (int) ($barH * 0.14));
        imagefilledellipse($img, $cx, $cy, $r * 2, $r * 2, $navy);
    }

    imagepng($img, $path);
    imagedestroy($img);
    echo "✓ {$path}\n";
}

function roundedRect($img, int $x1, int $y1, int $x2, int $y2, int $r, int $color): void
{
    imagefilledrectangle($img, $x1 + $r, $y1, $x2 - $r, $y2, $color);
    imagefilledrectangle($img, $x1, $y1 + $r, $x2, $y2 - $r, $color);
    imagefilledellipse($img, $x1 + $r, $y1 + $r, $r * 2, $r * 2, $color);
    imagefilledellipse($img, $x2 - $r, $y1 + $r, $r * 2, $r * 2, $color);
    imagefilledellipse($img, $x1 + $r, $y2 - $r, $r * 2, $r * 2, $color);
    imagefilledellipse($img, $x2 - $r, $y2 - $r, $r * 2, $r * 2, $color);
}

makeIcon(192, 0.22, $outDir . '/icon-192.png');
makeIcon(512, 0.22, $outDir . '/icon-512.png');
makeIcon(512, 0.30, $outDir . '/maskable-512.png');       // maskable: geniş güvenli alan
makeIcon(180, 0.22, __DIR__ . '/../web/public/apple-touch-icon.png');

echo "İkonlar hazır.\n";
