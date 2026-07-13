<?php
declare(strict_types=1);

/**
 * Test bootstrap: gerçek Depo servislerini in-memory SQLite'a karşı çalıştırır.
 * SQLite şeması, db/schema.sql'in taşınabilir bir izdüşümüdür (JSON→TEXT, ENUM→TEXT,
 * DATETIME(3)→TEXT, AUTO_INCREMENT→AUTOINCREMENT). Sync mantığı DB-agnostik yazıldığından
 * MySQL'de de aynı davranır.
 */

use Depo\Core\Autoloader;
use Depo\Core\Db;
use Depo\Core\Uuid;

require __DIR__ . '/../src/Core/Autoloader.php';
Autoloader::register(__DIR__ . '/../src');

date_default_timezone_set('UTC');

/** @return array{Db, PDO} */
function make_test_db(): array
{
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA foreign_keys = ON');

    $ddl = <<<SQL
    CREATE TABLE tenants (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'free',
      locale TEXT NOT NULL DEFAULT 'tr', settings TEXT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
    );
    CREATE TABLE tenant_users (
      tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
      PRIMARY KEY (tenant_id, user_id)
    );
    CREATE TABLE sessions (
      token TEXT PRIMARY KEY, user_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
    );
    CREATE TABLE change_log (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, entity TEXT NOT NULL,
      entity_id TEXT NOT NULL, op TEXT NOT NULL, payload TEXT NOT NULL, actor_id TEXT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
    );
    CREATE TABLE sync_ops (
      op_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
      PRIMARY KEY (tenant_id, op_id)
    );
    CREATE TABLE categories (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, parent_id TEXT NULL, name_tr TEXT NOT NULL,
      name_en TEXT NULL, code TEXT NOT NULL, attribute_schema TEXT NULL, sku_template TEXT NULL,
      default_count_mode TEXT NOT NULL DEFAULT 'exact', sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL, deleted_at TEXT NULL
    );
    CREATE TABLE locations (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, parent_id TEXT NULL, code TEXT NOT NULL,
      name TEXT NULL, type TEXT NOT NULL DEFAULT 'drawer', path TEXT NOT NULL, photo_id TEXT NULL,
      capacity_note TEXT NULL, sort_order INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
      deleted_at TEXT NULL
    );
    CREATE TABLE parts (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, category_id TEXT NULL, sku TEXT NOT NULL,
      name TEXT NOT NULL, mpn TEXT NULL, manufacturer TEXT NULL, attributes TEXT NULL, tags TEXT NULL,
      count_mode TEXT NOT NULL DEFAULT 'exact', abc_class TEXT NOT NULL DEFAULT 'C', min_qty NUMERIC NULL,
      unit TEXT NOT NULL DEFAULT 'adet', datasheet_url TEXT NULL, photo_id TEXT NULL, notes TEXT NULL,
      updated_at TEXT NOT NULL, deleted_at TEXT NULL
    );
    CREATE TABLE stock (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, part_id TEXT NOT NULL, location_id TEXT NOT NULL,
      qty NUMERIC NOT NULL DEFAULT 0, level TEXT NULL, level_at TEXT NULL, last_move_at TEXT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (tenant_id, part_id, location_id)
    );
    CREATE TABLE stock_transactions (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, part_id TEXT NOT NULL, location_id TEXT NOT NULL,
      delta NUMERIC NULL, level_to TEXT NULL, reason TEXT NOT NULL, project_id TEXT NULL, ref_id TEXT NULL,
      note TEXT NULL, actor_id TEXT NULL, created_at TEXT NOT NULL
    );
    SQL;

    $pdo->exec($ddl);
    return [Db::fromPdo($pdo), $pdo];
}

/** Test tenant + kullanıcı + üyelik oluşturur. */
function seed_tenant(Db $db, string $name = 'Test Atölye'): array
{
    $tid = Uuid::v7();
    $uid = Uuid::v7();
    $db->run('INSERT INTO tenants (id, name) VALUES (:id, :n)', ['id' => $tid, 'n' => $name]);
    $db->run('INSERT INTO users (id, email, password_hash, display_name) VALUES (:id, :e, :h, :n)',
        ['id' => $uid, 'e' => strtolower(str_replace(' ', '', $name)) . '@t.local', 'h' => 'x', 'n' => $name]);
    $db->run('INSERT INTO tenant_users (tenant_id, user_id, role) VALUES (:t, :u, :r)',
        ['t' => $tid, 'u' => $uid, 'r' => 'owner']);
    return ['tenant_id' => $tid, 'user_id' => $uid];
}

// --- minik test çerçevesi ---------------------------------------------------

$GLOBALS['__tests'] = ['pass' => 0, 'fail' => 0, 'failures' => []];

function check(bool $cond, string $label): void
{
    if ($cond) {
        $GLOBALS['__tests']['pass']++;
        fwrite(STDOUT, "  ✓ {$label}\n");
    } else {
        $GLOBALS['__tests']['fail']++;
        $GLOBALS['__tests']['failures'][] = $label;
        fwrite(STDOUT, "  ✗ {$label}\n");
    }
}

function eq(mixed $actual, mixed $expected, string $label): void
{
    $ok = $actual === $expected;
    if (!$ok && (is_float($expected) || is_float($actual))) {
        $ok = abs((float) $actual - (float) $expected) < 1e-9;
    }
    if (!$ok) {
        $label .= ' (beklenen=' . var_export($expected, true) . ', gelen=' . var_export($actual, true) . ')';
    }
    check($ok, $label);
}

function test_summary(): int
{
    $t = $GLOBALS['__tests'];
    fwrite(STDOUT, "\n" . str_repeat('─', 50) . "\n");
    fwrite(STDOUT, "GEÇEN: {$t['pass']}  BAŞARISIZ: {$t['fail']}\n");
    if ($t['fail'] > 0) {
        fwrite(STDOUT, "Başarısızlar:\n");
        foreach ($t['failures'] as $f) {
            fwrite(STDOUT, "  - {$f}\n");
        }
        return 1;
    }
    fwrite(STDOUT, "TÜM SENKRONİZASYON TESTLERİ GEÇTİ ✓\n");
    return 0;
}
