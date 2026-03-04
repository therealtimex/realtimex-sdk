import type { ExecutionResult, ToolCall } from '../../core/types/runtime';
import type { CanonicalToolDefinition, HostToolAdapter } from '../../core/types/tooling';

export interface GeminiFunctionDeclaration {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
}

export interface GeminiToolCall {
    id: string;
    name: string;
    args?: Record<string, unknown> | string;
}

export interface GeminiToolResult {
    tool_call_id: string;
    status: ExecutionResult['status'];
    payload: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseArgs(value: unknown): Record<string, unknown> {
    if (isRecord(value)) return value;

    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return isRecord(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }

    return {};
}

export class GeminiToolAdapter
    implements HostToolAdapter<GeminiFunctionDeclaration, GeminiToolCall, GeminiToolResult>
{
    toProviderTools(tools: CanonicalToolDefinition[]): GeminiFunctionDeclaration[] {
        return tools.map((tool) => ({
            name: tool.tool_name,
            description: tool.description,
            parameters: tool.input_schema,
        }));
    }

    fromProviderToolCall(call: GeminiToolCall): ToolCall {
        return {
            tool_call_id: call.id,
            tool_name: call.name,
            args: parseArgs(call.args),
        };
    }

    toProviderResult(result: ExecutionResult): GeminiToolResult {
        return {
            tool_call_id: result.tool_call_id || result.task_id || 'unknown',
            status: result.status,
            payload:
                result.status === 'failed'
                    ? { error: result.error }
                    : {
                          ...(result.output || {}),
                          task_id: result.task_id,
                          attempt_id: result.attempt_id,
                      },
        };
    }
}
