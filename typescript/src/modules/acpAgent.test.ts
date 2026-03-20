import { afterEach, describe, expect, it, vi } from "vitest";
import { AcpAgentModule } from "./acpAgent";
import type { HttpClient } from "./http";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** Minimal mock of HttpClient — skips token refresh, just delegates to mockFetch. */
function createMockHttpClient(): {
  httpClient: HttpClient;
  mockFetch: ReturnType<typeof vi.fn>;
} {
  const mockFetch = vi.fn<[string, RequestInit?], Promise<Response>>();
  const httpClient = {
    fetch: (endpoint: string, options?: RequestInit) =>
      mockFetch(endpoint, options),
  } as unknown as HttpClient;
  return { httpClient, mockFetch };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AcpAgentModule", () => {
  describe("listAgents", () => {
    it("returns agent array from server", async () => {
      const { httpClient, mockFetch } = createMockHttpClient();
      mockFetch.mockResolvedValue(
        jsonResponse({
          success: true,
          agents: [{ id: "claude", label: "Claude", installed: true }],
        })
      );

      const module = new AcpAgentModule(httpClient);
      const agents = await module.listAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe("claude");
    });

    it("throws on error response", async () => {
      const { httpClient, mockFetch } = createMockHttpClient();
      mockFetch.mockResolvedValue(jsonResponse({ error: "ACP disabled" }, 503));

      const module = new AcpAgentModule(httpClient);
      await expect(module.listAgents()).rejects.toThrow("ACP disabled");
    });
  });

  describe("createSession", () => {
    it("sends correct payload and returns session", async () => {
      const { httpClient, mockFetch } = createMockHttpClient();
      mockFetch.mockResolvedValue(
        jsonResponse({
          success: true,
          session: {
            session_key: "agent:claude:acp:uuid-1",
            agent_id: "claude",
            state: "ready",
          },
        })
      );

      const module = new AcpAgentModule(httpClient);
      const session = await module.createSession({
        agent_id: "claude",
        approvalPolicy: "approve-all",
      });

      expect(session.session_key).toBe("agent:claude:acp:uuid-1");
      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse(init?.body as string);
      expect(body.agent_id).toBe("claude");
      expect(body.approvalPolicy).toBe("approve-all");
    });
  });

  describe("getSession", () => {
    it("URL-encodes session key with colons", async () => {
      const { httpClient, mockFetch } = createMockHttpClient();
      mockFetch.mockResolvedValue(
        jsonResponse({
          success: true,
          session: { session_key: "agent:claude:acp:uuid-1" },
        })
      );

      const module = new AcpAgentModule(httpClient);
      await module.getSession("agent:claude:acp:uuid-1");
      const [endpoint] = mockFetch.mock.calls[0];
      expect(endpoint).toContain("agent%3Aclaude%3Aacp%3Auuid-1");
    });
  });

  describe("chat (sync)", () => {
    it("returns response text", async () => {
      const { httpClient, mockFetch } = createMockHttpClient();
      mockFetch.mockResolvedValue(
        jsonResponse({
          success: true,
          response: { text: "Hello world", stop_reason: "end_turn" },
        })
      );

      const module = new AcpAgentModule(httpClient);
      const res = await module.chat("sk-1", "hello");
      expect(res.text).toBe("Hello world");
      expect(res.stop_reason).toBe("end_turn");
    });
  });

  describe("streamChat", () => {
    it("parses named SSE events correctly", async () => {
      const { httpClient, mockFetch } = createMockHttpClient();
      mockFetch.mockResolvedValue(
        sseResponse([
          'event: text_delta\ndata: {"text":"Hello"}\n\n',
          'event: tool_call\ndata: {"text":"read_file","status":"running"}\n\n',
          'event: done\ndata: {"stopReason":"end_turn"}\n\n',
          'event: close\ndata: {"success":true}\n\n',
        ])
      );

      const module = new AcpAgentModule(httpClient);
      const events: Array<{ type: string; data: Record<string, unknown> }> = [];
      for await (const event of module.streamChat("sk-1", "hello")) {
        events.push(event);
      }

      expect(events).toHaveLength(4);
      expect(events[0].type).toBe("text_delta");
      expect(events[0].data.text).toBe("Hello");
      expect(events[1].type).toBe("tool_call");
      expect(events[2].type).toBe("done");
      expect(events[2].data.stopReason).toBe("end_turn");
      expect(events[3].type).toBe("close");
    });

    it("drops frames without event: line", async () => {
      const { httpClient, mockFetch } = createMockHttpClient();
      mockFetch.mockResolvedValue(
        sseResponse([
          'data: {"text":"no event line"}\n\n',
          'event: text_delta\ndata: {"text":"with event"}\n\n',
        ])
      );

      const module = new AcpAgentModule(httpClient);
      const events: Array<{ type: string }> = [];
      for await (const event of module.streamChat("sk-1", "hello")) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("text_delta");
    });

    it("throws on non-ok response", async () => {
      const { httpClient, mockFetch } = createMockHttpClient();
      mockFetch.mockResolvedValue(
        jsonResponse({ error: "Session not found" }, 404)
      );

      const module = new AcpAgentModule(httpClient);
      await expect(async () => {
        for await (const _ of module.streamChat("sk-bad", "hello")) {
          // consume
        }
      }).rejects.toThrow("Session not found");
    });
  });

  describe("resolvePermission", () => {
    it("sends camelCase fields", async () => {
      const { httpClient, mockFetch } = createMockHttpClient();
      mockFetch.mockResolvedValue(
        jsonResponse({ success: true, resolved: true })
      );

      const module = new AcpAgentModule(httpClient);
      const result = await module.resolvePermission("sk-1", {
        requestId: "r1",
        optionId: "allow_once",
      });

      expect(result.resolved).toBe(true);
      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse(init?.body as string);
      expect(body.requestId).toBe("r1");
      expect(body.optionId).toBe("allow_once");
      expect(body.outcome).toBeUndefined();
    });
  });

  describe("closeSession", () => {
    it("sends DELETE with reason", async () => {
      const { httpClient, mockFetch } = createMockHttpClient();
      mockFetch.mockResolvedValue(jsonResponse({ success: true }));

      const module = new AcpAgentModule(httpClient);
      await module.closeSession("sk-1", "done");
      const [, init] = mockFetch.mock.calls[0];
      expect(init?.method).toBe("DELETE");
      const body = JSON.parse(init?.body as string);
      expect(body.reason).toBe("done");
    });

    it("omits body when no reason", async () => {
      const { httpClient, mockFetch } = createMockHttpClient();
      mockFetch.mockResolvedValue(jsonResponse({ success: true }));

      const module = new AcpAgentModule(httpClient);
      await module.closeSession("sk-1");
      const [, init] = mockFetch.mock.calls[0];
      expect(init?.body).toBeUndefined();
    });
  });

  describe("startChat", () => {
    it("creates session then chats", async () => {
      const { httpClient, mockFetch } = createMockHttpClient();
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            session: {
              session_key: "sk-new",
              agent_id: "claude",
              state: "ready",
            },
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            response: { text: "Hi", stop_reason: "end_turn" },
          })
        );

      const module = new AcpAgentModule(httpClient);
      const { session, response } = await module.startChat("hello", {
        agent_id: "claude",
        approvalPolicy: "approve-all",
      });

      expect(session.session_key).toBe("sk-new");
      expect(response.text).toBe("Hi");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
