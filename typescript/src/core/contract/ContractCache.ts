import type { LocalAppContractV1 } from '../types/contract';

interface ContractCacheEntry {
    value: LocalAppContractV1;
    expiresAt: number | null;
}

export class ContractCache {
    private readonly ttlMs: number | null;
    private readonly entries = new Map<string, ContractCacheEntry>();

    constructor(ttlMs = 30_000) {
        this.ttlMs = ttlMs > 0 ? ttlMs : null;
    }

    get(key: string): LocalAppContractV1 | null {
        const entry = this.entries.get(key);
        if (!entry) return null;

        if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
            this.entries.delete(key);
            return null;
        }

        return entry.value;
    }

    set(key: string, value: LocalAppContractV1): void {
        const expiresAt = this.ttlMs === null ? null : Date.now() + this.ttlMs;
        this.entries.set(key, { value, expiresAt });
    }

    clear(key?: string): void {
        if (key) {
            this.entries.delete(key);
            return;
        }

        this.entries.clear();
    }
}
