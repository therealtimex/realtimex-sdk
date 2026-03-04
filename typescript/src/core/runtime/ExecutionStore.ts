import type { CanonicalToolDefinition } from '../types/tooling';

export class ExecutionStore {
    private readonly registries = new Map<string, Map<string, CanonicalToolDefinition>>();

    registerTools(registryKey: string, tools: CanonicalToolDefinition[]): void {
        const registry = new Map<string, CanonicalToolDefinition>();

        for (const tool of tools) {
            registry.set(tool.tool_name, tool);
        }

        this.registries.set(registryKey, registry);
    }

    hasRegistry(registryKey: string): boolean {
        return this.registries.has(registryKey);
    }

    getTool(registryKey: string, toolName: string): CanonicalToolDefinition | undefined {
        return this.registries.get(registryKey)?.get(toolName);
    }

    clear(registryKey?: string): void {
        if (registryKey) {
            this.registries.delete(registryKey);
            return;
        }

        this.registries.clear();
    }
}
