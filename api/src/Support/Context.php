<?php
declare(strict_types=1);

namespace Depo\Support;

/**
 * Doğrulanmış istek bağlamı. tenant_id DAİMA buradan gelir, asla istemciden
 * (ARCHITECTURE §3 — tenant izolasyonunun temeli).
 */
final class Context
{
    public function __construct(
        public readonly string $userId,
        public readonly string $tenantId,
        public readonly string $role,      // owner | member | viewer
    ) {}

    public function isOwner(): bool  { return $this->role === 'owner'; }
    public function canWrite(): bool { return $this->role === 'owner' || $this->role === 'member'; }
}
