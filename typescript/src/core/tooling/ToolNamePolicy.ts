function normalizeToken(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

export function toStableToolName(capabilityId: string, namespace?: string): string {
    const normalizedCapability = normalizeToken(capabilityId.replace(/\./g, '_'));
    const normalizedNamespace = namespace ? normalizeToken(namespace) : '';

    if (!normalizedCapability) {
        return normalizedNamespace ? `${normalizedNamespace}_tool` : 'tool';
    }

    const combined =
        normalizedNamespace && !normalizedCapability.startsWith(`${normalizedNamespace}_`)
            ? `${normalizedNamespace}_${normalizedCapability}`
            : normalizedCapability;

    return /^[a-z]/.test(combined) ? combined : `tool_${combined}`;
}
