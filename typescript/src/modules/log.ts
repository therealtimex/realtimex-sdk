/**
 * LogModule — Send structured logs from SDK apps to the RealtimeX system log.
 *
 * Logs are sent asynchronously (fire-and-forget) so they never block your app.
 * Failed sends are silently ignored to avoid cascading errors.
 *
 * @example
 * ```ts
 * sdk.log.info("My app started");
 * sdk.log.error("LLM call failed", { error: e.message, model: "gpt-4o" });
 * ```
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
export type LogSource = "app" | "server" | "llm" | "vector-db" | "channel" | "embed" | "external";

export interface LogEntry {
  level: LogLevel;
  source: LogSource;
  message: string;
  context?: Record<string, unknown>;
  timestamp?: string;
}

export interface LogResponse {
  success: boolean;
  ingested: number;
}

export class LogModule {
  private readonly baseUrl: string;
  private readonly appId: string;
  private readonly apiKey?: string;
  private queue: LogEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly FLUSH_INTERVAL_MS = 2000;
  private readonly BATCH_SIZE = 20;

  constructor(baseUrl: string, appId: string, apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.appId = appId;
    this.apiKey = apiKey;
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    if (this.appId) h["x-app-id"] = this.appId;
    return h;
  }

  /** Flush queued logs immediately — returns true on success */
  async flush(): Promise<boolean> {
    if (this.queue.length === 0) return true;
    const batch = this.queue.splice(0, this.BATCH_SIZE);
    try {
      const res = await fetch(`${this.baseUrl}/sdk/logs`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ logs: batch }),
      });
      return res.ok;
    } catch {
      // Fire-and-forget: silently discard on network error
      return false;
    }
  }

  private schedule(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch(() => {});
    }, this.FLUSH_INTERVAL_MS);
  }

  /** Queue a log entry and schedule a flush */
  log(level: LogLevel, message: string, context?: Record<string, unknown>, source: LogSource = "app"): void {
    this.queue.push({ level, source, message, context, timestamp: new Date().toISOString() });
    if (this.queue.length >= this.BATCH_SIZE) {
      if (this.flushTimer !== null) { clearTimeout(this.flushTimer); this.flushTimer = null; }
      this.flush().catch(() => {});
    } else {
      this.schedule();
    }
  }

  debug(message: string, context?: Record<string, unknown>, source: LogSource = "app"): void {
    this.log("debug", message, context, source);
  }

  info(message: string, context?: Record<string, unknown>, source: LogSource = "app"): void {
    this.log("info", message, context, source);
  }

  warn(message: string, context?: Record<string, unknown>, source: LogSource = "app"): void {
    this.log("warn", message, context, source);
  }

  error(message: string, context?: Record<string, unknown>, source: LogSource = "app"): void {
    this.log("error", message, context, source);
  }

  fatal(message: string, context?: Record<string, unknown>, source: LogSource = "app"): void {
    this.log("fatal", message, context, source);
  }
}
