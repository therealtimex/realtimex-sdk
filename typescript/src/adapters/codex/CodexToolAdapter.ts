import type { ExecutionResult, ToolCall } from '../../core/types/runtime';
import type { CanonicalToolDefinition, HostToolAdapter } from '../../core/types/tooling';

export interface CodexToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

export interface CodexToolCall {
    id: string;
    function: {
        name: string;
        arguments?: string | Record<string, unknown>;
    };
}

export interface CodexToolResult {
    tool_call_id: string;
    output: string;
    is_error?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseArguments(value: unknown): Record<string, unknown> {
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

export class CodexToolAdapter
    implements HostToolAdapter<CodexToolDefinition, CodexToolCall, CodexToolResult>
{
    toProviderTools(tools: CanonicalToolDefinition[]): CodexToolDefinition[] {
        return tools.map((tool) => ({
            type: 'function',
            function: {
                name: tool.tool_name,
                description: tool.description,
                parameters: tool.input_schema,
            },
        }));
    }

    fromProviderToolCall(call: CodexToolCall): ToolCall {
        return {
            tool_call_id: call.id,
            tool_name: call.function.name,
            args: parseArguments(call.function.arguments),
        };
    }

    toProviderResult(result: ExecutionResult): CodexToolResult {
        const outputPayload =
            result.status === 'failed'
                ? { error: result.error }
                : {
                      ...(result.output || {}),
                      task_id: result.task_id,
                      attempt_id: result.attempt_id,
                  };

        return {
            tool_call_id: result.tool_call_id || result.task_id || 'unknown',
            output: JSON.stringify(outputPayload),
            is_error: result.status === 'failed' ? true : undefined,
        };
    }
}
