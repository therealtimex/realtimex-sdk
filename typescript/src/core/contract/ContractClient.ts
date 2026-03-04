import type { LocalAppContractV1 } from '../types/contract';
import { ContractHttpClient } from '../transport/HttpClient';
import { ContractCache } from './ContractCache';
import { normalizeLocalAppContractV1 } from './ContractValidator';

export interface ContractClientOptions {
    cache?: ContractCache;
    cacheKey?: string;
}

export class ContractClient {
    private readonly httpClient: ContractHttpClient;
    private readonly cache: ContractCache;
    private readonly cacheKey: string;

    constructor(httpClient: ContractHttpClient, options: ContractClientOptions = {}) {
        this.httpClient = httpClient;
        this.cache = options.cache || new ContractCache();
        this.cacheKey = options.cacheKey || 'local-app-contract/v1';
    }

    async getLocalAppV1(forceRefresh = false): Promise<LocalAppContractV1> {
        if (!forceRefresh) {
            const cached = this.cache.get(this.cacheKey);
            if (cached) return cached;
        }

        const response = await this.httpClient.get<unknown>('/contracts/local-app/v1');
        const normalized = normalizeLocalAppContractV1(response);
        this.cache.set(this.cacheKey, normalized);
        return normalized;
    }

    clearCache(): void {
        this.cache.clear(this.cacheKey);
    }
}
