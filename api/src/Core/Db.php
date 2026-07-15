<?php
declare(strict_types=1);

namespace Depo\Core;

use PDO;

/**
 * PDO sarmalayıcı. Prepared statement zorunlu (CLAUDE.md §4).
 * Tek bağlantı; transaction yardımcıları.
 */
final class Db
{
    private PDO $pdo;

    /** @param array{host:string,port?:int,name:string,user:string,pass:string,charset?:string} $cfg */
    public function __construct(array $cfg)
    {
        $charset = $cfg['charset'] ?? 'utf8mb4';
        $port    = $cfg['port'] ?? 3306;
        $dsn = "mysql:host={$cfg['host']};port={$port};dbname={$cfg['name']};charset={$charset}";
        $this->pdo = new PDO($dsn, $cfg['user'], $cfg['pass'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
        // Her şey UTC (CLAUDE.md §4).
        $this->pdo->exec("SET time_zone = '+00:00'");
    }

    /** Test/DI için mevcut PDO'yu sarmalar. */
    public static function fromPdo(PDO $pdo): self
    {
        $self = (new \ReflectionClass(self::class))->newInstanceWithoutConstructor();
        $self->pdo = $pdo;
        return $self;
    }

    public function pdo(): PDO { return $this->pdo; }

    /** Sürücü MySQL/MariaDB mi? (GET_LOCK / FOR UPDATE gibi eklentiler için; testler SQLite.) */
    public function isMysql(): bool
    {
        return $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
    }

    /** @param array<string,mixed> $params */
    public function run(string $sql, array $params = []): \PDOStatement
    {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    }

    /** @param array<string,mixed> $params @return array<string,mixed>|null */
    public function one(string $sql, array $params = []): ?array
    {
        $row = $this->run($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    /** @param array<string,mixed> $params @return list<array<string,mixed>> */
    public function all(string $sql, array $params = []): array
    {
        return $this->run($sql, $params)->fetchAll();
    }

    public function begin(): void  { if (!$this->pdo->inTransaction()) $this->pdo->beginTransaction(); }
    public function commit(): void { if ($this->pdo->inTransaction()) $this->pdo->commit(); }
    public function rollback(): void { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); }

    /**
     * Tek dış transaction içinde op-başına izolasyon (SAVEPOINT). İsim SABİT literal —
     * SAVEPOINT bind parametre almaz; sabit ad kullanıldığından injection yok. Aynı adı
     * her turda yeniden SAVEPOINT'lemek eskisini değiştirir (liste 1'de kalır, RELEASE şart değil).
     * Kullanım: begin() → her op: savepoint(); dene; hata → rollbackToSavepoint(); en son commit().
     */
    public function savepoint(): void { $this->pdo->exec('SAVEPOINT op'); }
    public function rollbackToSavepoint(): void { $this->pdo->exec('ROLLBACK TO SAVEPOINT op'); }

    /** @template T @param callable():T $fn @return T */
    public function transaction(callable $fn): mixed
    {
        $this->begin();
        try {
            $result = $fn();
            $this->commit();
            return $result;
        } catch (\Throwable $e) {
            $this->rollback();
            throw $e;
        }
    }
}
