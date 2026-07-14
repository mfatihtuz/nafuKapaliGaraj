<?php
declare(strict_types=1);

namespace Depo\Repository;

use Depo\Core\Db;
use Depo\Core\HttpException;
use Depo\Core\Uuid;
use Depo\Support\Time;

/**
 * Tüm repository'ler buradan türer. HER sorgu tenant_id ile sınırlanır
 * (ARCHITECTURE §3, CLAUDE.md §4). Tenant scope'u atlayan sorgu yazma.
 */
abstract class BaseRepository
{
    public function __construct(
        protected readonly Db $db,
        protected readonly string $tenantId,   // ← middleware'den; ASLA istemciden
        protected readonly int $clockSkewMinutes = 5,
    ) {}

    /** Alt sınıflar tablo adını ve LWW ile yazılabilir alanları bildirir. */
    abstract protected function table(): string;

    /** @return list<string> Yazılabilir (whitelist) sütunlar — id/tenant_id hariç. */
    abstract protected function writableColumns(): array;

    /** @return list<string> JSON olarak saklanan sütunlar (dizi → json_encode). */
    protected function jsonColumns(): array { return []; }

    /** Referans alanı doğrulaması (alt sınıflar override eder). Varsayılan: yok. */
    protected function validateReferences(array $data): void {}

    /**
     * Bir referans id'sinin BAŞKA tenant'a ait olmadığını doğrular.
     * - Boş/null → serbest. Hiç yoksa → serbest (henüz senkronlanmamış olabilir,
     *   sıralı batch'te önce oluşur). Yalnızca FARKLI tenant'a aitse reddedilir.
     */
    protected function assertRefNotForeign(string $refTable, mixed $id, string $msg): void
    {
        if (!is_string($id) || $id === '') {
            return;
        }
        $row = $this->db->one("SELECT tenant_id FROM {$refTable} WHERE id = :id", ['id' => $id]);
        if ($row !== null && (string) $row['tenant_id'] !== $this->tenantId) {
            throw HttpException::unprocessable($msg);
        }
    }

    /**
     * Last-Write-Wins upsert (katalog varlıkları — SYNC_PROTOCOL §2A).
     * - id UUIDv7 olmalı.
     * - Kayıt başka tenant'a aitse 404 (varlığı sızdırma).
     * - Yalnızca gelen updated_at > mevcut updated_at ise güncelle.
     * @param array<string,mixed> $data
     * @return array<string,mixed> Yazımdan sonra kanonik satır (change_log payload'ı için).
     */
    public function lwwUpsert(array $data): array
    {
        $id = is_string($data['id'] ?? null) ? $data['id'] : '';
        // Varlık id'leri herhangi bir geçerli UUID olabilir (seed verisi v4; yeni istemci
        // kayıtları v7). op_id ise katı v7 kalır (SyncService).
        if (!Uuid::isValid($id)) {
            throw HttpException::unprocessable('Geçersiz id (UUID bekleniyor)');
        }

        $table = $this->table();
        $existing = $this->db->one(
            "SELECT tenant_id, updated_at FROM {$table} WHERE id = :id",
            ['id' => $id]
        );

        // Sahiplik: başka tenant'ın satırına dokunma.
        if ($existing !== null && (string) $existing['tenant_id'] !== $this->tenantId) {
            throw HttpException::notFound();
        }

        // Referans alanları BAŞKA tenant'a işaret etmesin (izolasyon savunması).
        $this->validateReferences($data);

        $incomingUpdatedAt = Time::clampUpdatedAt(
            is_string($data['updated_at'] ?? null) ? $data['updated_at'] : null,
            $this->clockSkewMinutes
        );

        // Yeni kayıt → INSERT
        if ($existing === null) {
            $this->insertRow($id, $data, $incomingUpdatedAt);
            return $this->findRaw($id);
        }

        // Mevcut kayıt → sadece daha yeniyse UPDATE (LWW)
        if (Time::gt($incomingUpdatedAt, (string) $existing['updated_at'])) {
            $this->updateRow($id, $data, $incomingUpdatedAt);
        }
        // else: gelen daha eski → yok say (kayıp kabul edilebilir, SYNC_PROTOCOL §2A)

        return $this->findRaw($id);
    }

    /** Soft delete (SYNC_PROTOCOL §2A — hard delete asla senkronize edilmez). */
    public function softDelete(string $id, ?string $updatedAtIso = null): array
    {
        if (!Uuid::isValid($id)) {
            throw HttpException::unprocessable('Geçersiz id');
        }
        $table = $this->table();
        $existing = $this->db->one(
            "SELECT tenant_id, updated_at FROM {$table} WHERE id = :id",
            ['id' => $id]
        );
        if ($existing === null) {
            throw HttpException::notFound();
        }
        if ((string) $existing['tenant_id'] !== $this->tenantId) {
            throw HttpException::notFound();
        }
        // LWW: yalnızca silme, mevcut updated_at'ten yeniyse uygulanır (SYNC_PROTOCOL §2A).
        // Eski (sıra dışı) bir silme, daha yeni bir düzenlemeyi ezmemeli; updated_at geri gitmez.
        $ts = Time::clampUpdatedAt($updatedAtIso, $this->clockSkewMinutes);
        if (Time::gt($ts, (string) $existing['updated_at'])) {
            $this->db->run(
                "UPDATE {$table} SET deleted_at = :ts, updated_at = :ts2 WHERE id = :id AND tenant_id = :tid",
                ['ts' => $ts, 'ts2' => $ts, 'id' => $id, 'tid' => $this->tenantId]
            );
        }
        // else: gelen silme daha eski → yok say (kanonik satırı olduğu gibi döndür).
        return $this->findRaw($id);
    }

    /** Tenant-scope'lu tekil getirme (controller'lar için). */
    public function findById(string $id): ?array
    {
        $table = $this->table();
        $row = $this->db->one(
            "SELECT * FROM {$table} WHERE id = :id AND tenant_id = :tid",
            ['id' => $id, 'tid' => $this->tenantId]
        );
        return $row === null ? null : $this->hydrate($row);
    }

    /** @return list<array<string,mixed>> */
    public function allActive(): array
    {
        $table = $this->table();
        $rows = $this->db->all(
            "SELECT * FROM {$table} WHERE tenant_id = :tid AND deleted_at IS NULL",
            ['tid' => $this->tenantId]
        );
        return array_map([$this, 'hydrate'], $rows);
    }

    // --- iç yardımcılar -----------------------------------------------------

    private function insertRow(string $id, array $data, string $updatedAt): void
    {
        $cols = ['id', 'tenant_id'];
        $place = [':id', ':tenant_id'];
        $bind = ['id' => $id, 'tenant_id' => $this->tenantId];

        foreach ($this->writableColumns() as $col) {
            if (!array_key_exists($col, $data)) {
                continue;
            }
            $cols[] = $col;
            $place[] = ':' . $col;
            $bind[$col] = $this->encodeValue($col, $data[$col]);
        }
        $cols[] = 'updated_at';
        $place[] = ':updated_at';
        $bind['updated_at'] = $updatedAt;

        $sql = 'INSERT INTO ' . $this->table()
            . ' (' . implode(', ', $cols) . ') VALUES (' . implode(', ', $place) . ')';
        $this->db->run($sql, $bind);
    }

    private function updateRow(string $id, array $data, string $updatedAt): void
    {
        $sets = [];
        $bind = ['id' => $id, 'tid' => $this->tenantId, 'updated_at' => $updatedAt];
        foreach ($this->writableColumns() as $col) {
            if (!array_key_exists($col, $data)) {
                continue;
            }
            $sets[] = "{$col} = :{$col}";
            $bind[$col] = $this->encodeValue($col, $data[$col]);
        }
        $sets[] = 'updated_at = :updated_at';
        $sql = 'UPDATE ' . $this->table() . ' SET ' . implode(', ', $sets)
            . ' WHERE id = :id AND tenant_id = :tid';
        $this->db->run($sql, $bind);
    }

    private function encodeValue(string $col, mixed $value): mixed
    {
        if (in_array($col, $this->jsonColumns(), true)) {
            if ($value === null) {
                return null;
            }
            return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }
        if (is_bool($value)) {
            return $value ? 1 : 0;
        }
        return $value;
    }

    /** Kanonik satır (change_log payload'ı için). Tenant kapsamı zorunlu (savunma-derinliği). */
    protected function findRaw(string $id): array
    {
        $row = $this->db->one(
            'SELECT * FROM ' . $this->table() . ' WHERE id = :id AND tenant_id = :tid',
            ['id' => $id, 'tid' => $this->tenantId]
        );
        return $row === null ? [] : $this->hydrate($row);
    }

    /** DB satırını istemci biçimine getirir (JSON sütunları decode). */
    protected function hydrate(array $row): array
    {
        foreach ($this->jsonColumns() as $col) {
            if (isset($row[$col]) && is_string($row[$col])) {
                $decoded = json_decode($row[$col], true);
                $row[$col] = $decoded;
            }
        }
        return $row;
    }
}
