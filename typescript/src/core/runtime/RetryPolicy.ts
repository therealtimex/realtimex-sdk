export interface RetryPolicyOptions {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    shouldRetry?: (error: unknown, attempt: number) => boolean;
}

function defaultShouldRetry(error: unknown): boolean {
    if (error && typeof error === 'object') {
        const status = (error as { statusCode?: unknown }).statusCode;
        if (typeof status === 'number') {
            return status >= 500 || status === 429;
        }
    }

    return true;
}

export class RetryPolicy {
    private readonly maxAttempts: number;
    private readonly baseDelayMs: number;
    private readonly maxDelayMs: number;
    private readonly shouldRetry: (error: unknown, attempt: number) => boolean;

    constructor(options: RetryPolicyOptions = {}) {
        this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
        this.baseDelayMs = Math.max(0, options.baseDelayMs ?? 150);
        this.maxDelayMs = Math.max(this.baseDelayMs, options.maxDelayMs ?? 2_000);
        this.shouldRetry = options.shouldRetry || ((error) => defaultShouldRetry(error));
    }

    async execute<T>(operation: (attempt: number) => Promise<T>): Promise<T> {
        let lastError: unknown = null;

        for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
            try {
                return await operation(attempt);
            } catch (error) {
                lastError = error;
                const canRetry = attempt < this.maxAttempts && this.shouldRetry(error, attempt);
                if (!canRetry) throw error;

                const delayMs = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (attempt - 1));
                if (delayMs > 0) {
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                }
            }
        }

        throw lastError instanceof Error ? lastError : new Error('Retry operation failed');
    }
}
