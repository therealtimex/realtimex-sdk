/**
 * ACP Agent Module — CLI-based agent sessions via ACP bridge
 *
 * Provides session lifecycle, sync/streaming chat, permission resolution,
 * and turn control for CLI agents (Claude, Gemini, Codex, etc.).
 *
 * Unlike AgentModule (LLM API-based), ACP agents spawn CLI processes
 * and can execute commands, read/write files, and interact with tools.
 */

import { HttpClient } from "./http";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AcpAgentInfo {
  id: string;
  label: string;
  handles: string[];
  installed: boolean;
  authReady: boolean;
  version?: string;
  status: "installed" | "not_installed";
}

export interface AcpSessionOptions {
  agent_id: string;
  cwd?: string;
  label?: string;
  approvalPolicy?: "approve-all" | "approve-reads" | "deny-all";
}

export interface AcpSession {
  session_key: string;
  agent_id: string;
  state: "initializing" | "ready" | "stale" | "closed";
  backend_id: string;
  created_at: string;
}

export interface AcpSessionStatus extends AcpSession {
  runtime_options: AcpRuntimeOptionPatch;
  last_activity_at: string | null;
  last_error?: string;
}

export interface AcpRuntimeOptionPatch {
  model?: string;
  cwd?: string;
  timeoutSeconds?: number;
  runtimeMode?: string;
  approvalPolicy?: "approve-all" | "approve-reads" | "deny-all";
  extras?: Record<string, string>;
}

export interface AcpChatResponse {
  text: string;
  stop_reason?: string;
}

export interface AcpStreamEvent {
  type:
    | "text_delta"
    | "status"
    | "tool_call"
    | "permission_request"
    | "done"
    | "error"
    | "close";
  data: Record<string, unknown>;
}

export interface AcpPermissionDecision {
  requestId: string;
  optionId: string;
  outcome?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeSessionKey(sessionKey: string): string {
  return encodeURIComponent(sessionKey);
}

async function parseJsonResponse<T>(
  response: Response,
  fallbackError: string
): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || fallbackError);
  return data as T;
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export class AcpAgentModule {
  private httpClient: HttpClient;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  /** List available CLI agents with installation/auth status. */
  async listAgents(): Promise<AcpAgentInfo[]> {
    const response = await this.httpClient.fetch("/sdk/acp/agents");
    const data = await parseJsonResponse<{ agents: AcpAgentInfo[] }>(
      response,
      "Failed to list agents"
    );
    return data.agents;
  }

  /** Create and initialize a new ACP session. Spawns the CLI agent process. */
  async createSession(options: AcpSessionOptions): Promise<AcpSession> {
    const response = await this.httpClient.fetch("/sdk/acp/session", {
      method: "POST",
      body: JSON.stringify(options),
    });
    const data = await parseJsonResponse<{ session: AcpSession }>(
      response,
      "Failed to create session"
    );
    return data.session;
  }

  /** Get session status and runtime options. */
  async getSession(sessionKey: string): Promise<AcpSessionStatus> {
    const response = await this.httpClient.fetch(
      `/sdk/acp/session/${encodeSessionKey(sessionKey)}`
    );
    const data = await parseJsonResponse<{ session: AcpSessionStatus }>(
      response,
      "Failed to get session"
    );
    return data.session;
  }

  /** List active ACP sessions owned by this app. */
  async listSessions(): Promise<AcpSessionStatus[]> {
    const response = await this.httpClient.fetch("/sdk/acp/sessions");
    const data = await parseJsonResponse<{ sessions: AcpSessionStatus[] }>(
      response,
      "Failed to list sessions"
    );
    return data.sessions;
  }

  /** Update runtime options (applied on next turn). */
  async patchSession(
    sessionKey: string,
    patch: AcpRuntimeOptionPatch
  ): Promise<void> {
    const response = await this.httpClient.fetch(
      `/sdk/acp/session/${encodeSessionKey(sessionKey)}`,
      { method: "PATCH", body: JSON.stringify(patch) }
    );
    await parseJsonResponse(response, "Failed to update session");
  }

  /** Close session and stop the agent process. */
  async closeSession(sessionKey: string, reason?: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `/sdk/acp/session/${encodeSessionKey(sessionKey)}`,
      {
        method: "DELETE",
        body: reason ? JSON.stringify({ reason }) : undefined,
      }
    );
    await parseJsonResponse(response, "Failed to close session");
  }

  /**
   * Synchronous turn — waits for completion, returns full response.
   * Requires approvalPolicy set on the session (via create or patchSession).
   */
  async chat(sessionKey: string, message: string): Promise<AcpChatResponse> {
    const response = await this.httpClient.fetch(
      `/sdk/acp/session/${encodeSessionKey(sessionKey)}/chat`,
      { method: "POST", body: JSON.stringify({ message }) }
    );
    const data = await parseJsonResponse<{ response: AcpChatResponse }>(
      response,
      "Chat request failed"
    );
    return data.response;
  }

  /**
   * Streaming turn via SSE. Yields events as they arrive.
   *
   * Uses named SSE events (event: + data: lines). The event type comes
   * from the `event:` line, not from inside the JSON payload.
   *
   * @example
   * ```typescript
   * for await (const event of sdk.acpAgent.streamChat(key, 'Explain this')) {
   *   if (event.type === 'text_delta') console.log(event.data.text);
   *   if (event.type === 'permission_request') {
   *     await sdk.acpAgent.resolvePermission(key, {
   *       requestId: event.data.requestId as string,
   *       optionId: 'allow_once',
   *     });
   *   }
   * }
   * ```
   */
  async *streamChat(
    sessionKey: string,
    message: string
  ): AsyncIterableIterator<AcpStreamEvent> {
    const response = await this.httpClient.fetch(
      `/sdk/acp/session/${encodeSessionKey(sessionKey)}/chat/stream`,
      { method: "POST", body: JSON.stringify({ message }) }
    );

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Stream request failed");
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    yield* parseNamedSSEStream(response.body);
  }

  /** Cancel the active turn on a session. */
  async cancelTurn(sessionKey: string, reason?: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `/sdk/acp/session/${encodeSessionKey(sessionKey)}/cancel`,
      {
        method: "POST",
        body: reason ? JSON.stringify({ reason }) : undefined,
      }
    );
    await parseJsonResponse(response, "Failed to cancel turn");
  }

  /** Resolve a pending permission request (call while SSE stream is active). */
  async resolvePermission(
    sessionKey: string,
    decision: AcpPermissionDecision
  ): Promise<{ resolved: boolean; reason?: string }> {
    const response = await this.httpClient.fetch(
      `/sdk/acp/session/${encodeSessionKey(sessionKey)}/permission`,
      { method: "POST", body: JSON.stringify(decision) }
    );
    return parseJsonResponse(response, "Failed to resolve permission");
  }

  /** Convenience: create session + first sync chat in one call. */
  async startChat(
    message: string,
    options: AcpSessionOptions
  ): Promise<{ session: AcpSession; response: AcpChatResponse }> {
    const session = await this.createSession(options);
    const chatResponse = await this.chat(session.session_key, message);
    return { session, response: chatResponse };
  }
}

// ---------------------------------------------------------------------------
// Named SSE parser
//
// Reads both `event:` and `data:` lines per the SSE spec. The event type
// is determined by the `event:` line, not a field inside the JSON payload.
// This differs from AgentModule's parser which only reads `data:` lines.
// ---------------------------------------------------------------------------

async function* parseNamedSSEStream(
  body: ReadableStream<Uint8Array>
): AsyncIterableIterator<AcpStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const jsonStr = line.slice(6);
          try {
            const data = JSON.parse(jsonStr);
            const type = (currentEvent || data.type || "unknown") as AcpStreamEvent["type"];
            yield { type, data };
          } catch {
            // skip malformed JSON
          }
          currentEvent = "";
        } else if (line === "") {
          // empty line resets event per SSE spec
          currentEvent = "";
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
