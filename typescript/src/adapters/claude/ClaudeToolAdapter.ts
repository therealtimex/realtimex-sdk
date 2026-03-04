import type { ExecutionResult, ToolCall } from '../../core/types/runtime';
import type { CanonicalToolDefinition, HostToolAdapter } from '../../core/types/tooling';

export interface ClaudeToolDefinition {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
}

export interface ClaudeToolCall {
    id: string;
    name: string;
    input?: Record<string, unknown>;
}

export interface ClaudeToolResult {
    type: 'tool_result';
    tool_use_id: string;
    content: string;
    is_error?: boolean;
}

export class ClaudeToolAdapter
    implements HostToolAdapter<ClaudeToolDefinition, ClaudeToolCall, ClaudeToolResult>
{
    toProviderTools(tools: CanonicalToolDefinition[]): ClaudeToolDefinition[] {
        return tools.map((tool) => ({
            name: tool.tool_name,
            description: tool.description,
            input_schema: tool.input_schema,
        }));
    }

    fromProviderToolCall(call: ClaudeToolCall): ToolCall {
        return {
            tool_call_id: call.id,
            tool_name: call.name,
            args: call.input || {},
        };
    }

    toProviderResult(result: ExecutionResult): ClaudeToolResult {
        const contentPayload =
            result.status === 'failed'
                ? { error: result.error }
                : {
                      ...(result.output || {}),
                      task_id: result.task_id,
                      attempt_id: result.attempt_id,
                  };

        return {
            type: 'tool_result',
            tool_use_id: result.tool_call_id || result.task_id || 'unknown',
            content: JSON.stringify(contentPayload),
            is_error: result.status === 'failed' ? true : undefined,
        };
    }
}
