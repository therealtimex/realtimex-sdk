import { ScopeDeniedError } from '../errors/ContractErrors';

export class ScopeGuard {
    private readonly scopes: Set<string>;

    constructor(scopes: string[] = []) {
        this.scopes = new Set(scopes.filter((scope) => scope.trim().length > 0));
    }

    can(permission?: string): boolean {
        if (!permission) return true;
        if (this.scopes.size === 0) return true;
        return this.scopes.has(permission);
    }

    assert(permission?: string): void {
        if (!permission) return;
        if (!this.can(permission)) {
            throw new ScopeDeniedError(permission);
        }
    }
}
