import type { CanonicalToolDefinition, ProjectToolsInput } from '../types/tooling';
import { normalizeSchema } from './SchemaNormalizer';
import { toStableToolName } from './ToolNamePolicy';

export class ToolProjector {
    project(input: ProjectToolsInput): CanonicalToolDefinition[] {
        const capabilities = input.contract.capabilities || [];
        const names = new Set<string>();

        return capabilities.map((capability) => {
            const baseName = toStableToolName(capability.capability_id, input.namespace || input.appId);
            const uniqueName = this.ensureUniqueToolName(baseName, names);

            return {
                tool_name: uniqueName,
                title: capability.name,
                description: capability.description,
                input_schema: normalizeSchema(capability.input_schema),
                output_schema: capability.output_schema,
                permission: capability.permission,
                capability_id: capability.capability_id,
                trigger: capability.trigger,
            };
        });
    }

    private ensureUniqueToolName(baseName: string, names: Set<string>): string {
        if (!names.has(baseName)) {
            names.add(baseName);
            return baseName;
        }

        let index = 2;
        while (names.has(`${baseName}_${index}`)) {
            index += 1;
        }

        const uniqueName = `${baseName}_${index}`;
        names.add(uniqueName);
        return uniqueName;
    }
}
