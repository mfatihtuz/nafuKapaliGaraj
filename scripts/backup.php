<?php
declare(strict_types=1);

/**
 * DEPO — günlük yedek (ARCHITECTURE §6). Hostinger cron ile çalışır:
 *   php /home/uXXXX/.../depo_yonetimi/private/scripts/backup.php
 * (veya bu dosyayı private/ altına koy ve yolu ona göre ayarla.)
 *
 * Tüm tenant verisini JSON olarak dışa aktarır → backups/depo_YYYY-MM-DD.json.gz
 * Son 30 günü tutar.
 */

// config.php'yi bul (private/ altında).
$configCandidates = [
    __DIR__ . '/../config.php',       // private/scripts/backup.php → private/config.php
    __DIR__ . '/config.php',
    dirname(__DIR__, 2) . '/private/config.php',
];
$config = null;
foreach ($configCandidates as $c) {
    if (is_file($c)) { $config = require $c; break; }
}
if ($config === null) {
    fwrite(STDERR, "config.php bulunamadı\n");
    exit(1);
}

$db = $config['db'];
$pdo = new PDO(
    "mysql:host={$db['host']};port=" . ($db['port'] ?? 3306) . ";dbname={$db['name']};charset=" . ($db['charset'] ?? 'utf8mb4'),
    $db['user'],
    $db['pass'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
);

$tables = [
    'tenants', 'users', 'tenant_users', 'categories', 'locations', 'parts',
    'stock', 'stock_transactions', 'projects', 'bom_items', 'loans',
    'suppliers', 'part_suppliers', 'purchase_orders', 'po_items', 'audit_sessions',
];

$dump = ['app' => 'depo', 'created_at' => gmdate('Y-m-d\TH:i:s\Z'), 'tables' => []];
foreach ($tables as $t) {
    try {
        $dump['tables'][$t] = $pdo->query("SELECT * FROM {$t}")->fetchAll();
    } catch (\Throwable $e) {
        $dump['tables'][$t] = ['__error' => $e->getMessage()];
    }
}

$backupDir = $config['storage']['path'] ?? (__DIR__ . '/../backups');
$backupDir = rtrim($backupDir, '/');
if (!is_dir($backupDir)) {
    @mkdir($backupDir, 0755, true);
}

$file = $backupDir . '/depo_' . gmdate('Y-m-d') . '.json.gz';
$json = json_encode($dump, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
file_put_contents($file, gzencode((string) $json, 6));
echo "Yedek: {$file}\n";

// 30 günden eski yedekleri sil.
foreach (glob($backupDir . '/depo_*.json.gz') ?: [] as $old) {
    if (filemtime($old) < time() - 30 * 86400) {
        @unlink($old);
        echo "Silindi (eski): {$old}\n";
    }
}
