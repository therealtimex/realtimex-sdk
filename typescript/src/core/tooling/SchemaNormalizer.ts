function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeSchema(schema?: Record<string, unknown>): Record<string, unknown> {
    if (!schema || !isRecord(schema)) {
        return {
            type: 'object',
            properties: {},
            additionalProperties: true,
        };
    }

    const normalized = deepClone(schema);

    if (typeof normalized.type !== 'string' && !Array.isArray(normalized.type)) {
        normalized.type = 'object';
    }

    if (normalized.type === 'object' && !isRecord(normalized.properties)) {
        normalized.properties = {};
    }

    if (Array.isArray(normalized.required)) {
        normalized.required = normalized.required.filter(
            (field): field is string => typeof field === 'string' && field.trim().length > 0
        );
    }

    return normalized;
}
