import path from "node:path";
import { resolveEndpoint } from "../client.js";
import { UsageError } from "../error.js";
import runner from "./runner.cjs";

export const executionContract = "himalaya-execution@1";
const identifier = /^[A-Za-z0-9_-]{1,128}$/;
const safeCodes = new Set(["EMAIL_CONTEXT_UNAVAILABLE", "EMAIL_BINDING_MISMATCH",
  "EMAIL_BINDING_CHANGED", "EMAIL_TARGET_CHANGED", "EMAIL_TARGET_INVALID",
  "EMAIL_ACCOUNT_MISSING", "EMAIL_PLUGIN_DISABLED", "EMAIL_OPERATION_INVALID",
  "EMAIL_OPERATION_UNSUPPORTED", "EMAIL_VERSION_UNSUPPORTED", "EMAIL_PASSWORD_INVALID",
  "EMAIL_BINARY_UNAVAILABLE", "EMAIL_CONFIG_INVALID", "EMAIL_AUTH_FAILED",
  "EMAIL_NETWORK_FAILED", "EMAIL_TLS_FAILED", "EMAIL_COMMAND_FAILED",
  "EMAIL_OPERATION_TIMEOUT", "EMAIL_OPERATION_CANCELLED", "EMAIL_OUTPUT_LIMIT",
  "EMAIL_OUTPUT_INVALID", "SECRET_NOT_FOUND", "SECRET_SCOPE_DENIED", "SECRET_DISABLED",
  "SECRET_UNDECRYPTABLE", "SECRET_FIELD_NOT_FOUND", "SECRET_LOGIN_REQUIRED",
  "EMAIL_PAGE_OUT_OF_RANGE", "EMAIL_CREDENTIAL_COMMAND_FAILED"]);
safeCodes.add("EMAIL_PLATFORM_UNSUPPORTED");
const fail = code => Object.assign(new Error(code), { code });
export const himalayaFailureCode = error => safeCodes.has(error?.code) ? error.code : "EMAIL_CONTEXT_UNAVAILABLE";
const mutationFailures = new WeakMap();
// Only context authored by this adapter can enter CLI output. Arbitrary error
// properties (including host diagnostics or a runner exception) are ignored.
export const himalayaFailureResult = error => ({ ok: false, code: himalayaFailureCode(error),
  ...(error && typeof error === "object" ? mutationFailures.get(error) : undefined) });

export function parseHimalayaArguments(argv) {
  const options = {};
  const allowed = ["plugin", "account", "binding", "operation", "folder", "from", "to", "uids", "page", "page-size", "query"];
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i]?.slice(2);
    if (!argv[i]?.startsWith("--") || !allowed.includes(key) || options[key] !== undefined ||
        typeof argv[i + 1] !== "string" || !argv[i + 1] || argv[i + 1].startsWith("-"))
      throw new UsageError("Invalid Himalaya option. See rtxexec --help.");
    options[key] = argv[i + 1];
  }
  if (!identifier.test(options.plugin || "") || !/^[A-Za-z0-9_-]{1,80}$/.test(options.account || "") ||
      options.binding !== undefined && !identifier.test(options.binding))
    throw new UsageError("Provide --plugin, --account and the selected --binding when managed by Secrets.");
  const request = { pluginId: options.plugin, account: options.account, operation: options.operation,
    ...(options.binding ? { bindingId: options.binding } : {}) };
  const expected = {
    folders: [], envelopes: ["folder", "page", "page-size", "query"],
    move: ["from", "to", "uids"], "add-folder": ["folder"]
  }[request.operation];
  if (!expected || Object.keys(options).some(key => !["plugin", "account", "binding", "operation", ...expected].includes(key)))
    throw new UsageError("Unsupported Himalaya operation or option.");
  for (const key of expected) {
    if (key === "query" && options[key] === undefined) continue;
    if (key === "page" || key === "page-size") {
      if (!/^[1-9][0-9]{0,4}$/.test(options[key] || "")) throw new UsageError("Use positive page and page-size values.");
      request[key === "page-size" ? "pageSize" : key] = Number(options[key]);
    } else if (key === "uids") request.uids = options[key]?.split(",");
    else request[key] = options[key];
  }
  try {
    runner.operationArgs({ ...request, configPaths: [process.platform === "win32" ? "\\\\fixture\\rtx\\config.toml" : path.resolve("config.toml")] });
  } catch { throw new UsageError("Invalid bounded Himalaya operation. No command was launched."); }
  return request;
}

async function readResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) throw fail("EMAIL_CONTEXT_UNAVAILABLE");
  const decoder = new TextDecoder(); let text = ""; let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 512 * 1024) { await reader.cancel(); throw fail("EMAIL_CONTEXT_UNAVAILABLE"); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch { throw fail("EMAIL_CONTEXT_UNAVAILABLE"); }
  finally { reader.releaseLock(); }
}

async function rpc(action, body, env, fetchImpl, signal) {
  const token = env.REALTIMEX_TERMINAL_SESSION_TOKEN;
  if (typeof token !== "string" || !token) throw fail("EMAIL_CONTEXT_UNAVAILABLE");
  let endpoint;
  try { endpoint = resolveEndpoint(env); } catch { throw fail("EMAIL_CONTEXT_UNAVAILABLE"); }
  endpoint.pathname = endpoint.pathname.replace(/\/secrets\/resolve$/, "/email/himalaya/" + action);
  const requestController = new AbortController();
  const abort = () => requestController.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, 5000);
  let response; let result;
  try {
    response = await fetchImpl(endpoint, { method: "POST", redirect: "error",
      signal: requestController.signal,
      headers: { Authorization: `RealtimeX-Terminal ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contractVersion: executionContract, ...body }) });
    result = await readResponse(response);
  } catch { throw fail(signal?.aborted ? "EMAIL_OPERATION_CANCELLED" : "EMAIL_CONTEXT_UNAVAILABLE"); }
  finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
  if (!response.ok || result.success !== true)
    throw fail(safeCodes.has(result.code) ? result.code : "EMAIL_CONTEXT_UNAVAILABLE");
  if (result.contractVersion !== executionContract) throw fail("EMAIL_CONTEXT_UNAVAILABLE");
  return result;
}

// The host admits against the live registry and atomically binds credential
// ID/reference/field/account/target. No caller workspace, token cache or secret
// reference is an execution authority. Values never leave this outer runner.
export async function runTerminalHimalaya(request, env = process.env, {
  fetchImpl = fetch, run = runner.runHimalaya, signalSource = process,
  signal, revalidateMs = 1000
} = {}) {
  const allowed = ["pluginId", "account", "bindingId", "operation", "folder", "from", "to", "uids", "page", "pageSize", "query"];
  if (!request || typeof request !== "object" || Object.keys(request).some(key => !allowed.includes(key)) ||
      !identifier.test(request.pluginId || "") || !/^[A-Za-z0-9_-]{1,80}$/.test(request.account || "") ||
      request.bindingId !== undefined && !identifier.test(request.bindingId)) throw fail("EMAIL_OPERATION_INVALID");
  try { runner.operationArgs({ ...request, configPaths: [process.platform === "win32" ? "\\\\fixture\\rtx\\config.toml" : path.resolve("config.toml")] }); }
  catch { throw fail("EMAIL_OPERATION_INVALID"); }
  const controller = new AbortController();
  const abort = () => controller.abort();
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const name of signals) signalSource.on(name, abort);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  let timer; let stopped = false; let admissionError; let admission;
  let operationId; let executionStarted = false;
  const mutation = ["move", "add-folder"].includes(request.operation);
  try {
    if (controller.signal.aborted) throw fail("EMAIL_OPERATION_CANCELLED");
    admission = await rpc("admit", request, env, fetchImpl, controller.signal);
    const p = admission.plan;
    const expiresAt = Date.parse(admission.expiresAt);
    if (!identifier.test(admission.operationId || "") || !Number.isFinite(expiresAt) ||
        expiresAt <= Date.now() || expiresAt > Date.now() + 125000 || !p ||
        p.account !== request.account || p.bindingId !== request.bindingId ||
        typeof p.binary !== "string" || !path.isAbsolute(p.binary) ||
        typeof p.targetRevision !== "string" || !/^[a-f0-9]{64}$/.test(p.targetRevision) ||
        (request.bindingId || p.bindingRevision !== undefined) &&
          (typeof p.bindingRevision !== "string" || !/^[a-f0-9]{64}$/.test(p.bindingRevision)) ||
        !Array.isArray(p.configRevisions) || p.configRevisions.length !== p.configPaths?.length ||
        p.configRevisions.some((item, index) => item?.path !== p.configPaths[index] || !/^[a-f0-9]{64}$/.test(item.revision)) ||
        (request.bindingId ? typeof admission.password !== "string" : admission.password !== undefined))
      throw fail("EMAIL_CONTEXT_UNAVAILABLE");
    // Reconstruct the bounded operation locally. A malformed host reply cannot
    // change the operation or supply arbitrary extra launcher options.
    const plan = { ...request, binary: p.binary, configPaths: p.configPaths,
      configRevisions: p.configRevisions, targetRevision: p.targetRevision,
      bindingRevision: p.bindingRevision };
    runner.operationArgs(plan);
    operationId = admission.operationId;
    const validate = async () => {
      if (Date.now() >= expiresAt) throw fail("EMAIL_CONTEXT_UNAVAILABLE");
      const result = await rpc("validate", { operationId: admission.operationId }, env, fetchImpl, controller.signal);
      if (result.operationId !== admission.operationId) throw fail("EMAIL_CONTEXT_UNAVAILABLE");
    };
    const refresh = async () => {
      if (stopped) return;
      try { await validate(); }
      catch (error) { if (!stopped) { admissionError = error; controller.abort(); } }
      finally { if (!stopped && !controller.signal.aborted) timer = setTimeout(refresh, revalidateMs); }
    };
    await validate();
    if (controller.signal.aborted) throw fail("EMAIL_OPERATION_CANCELLED");
    timer = setTimeout(refresh, revalidateMs);
    const result = await run(plan, { password: admission.password, environment: env,
      signal: controller.signal, validateAdmission: validate,
      onExecutionStart: () => { executionStarted = true; } });
    if (admissionError) throw admissionError;
    await validate();
    return mutation ? { ...result, operationId, outcome: "confirmed" } : result;
  } catch (error) {
    const failure = fail(himalayaFailureCode(admissionError || error));
    if (mutation && operationId) {
      const context = { operationId, outcome: executionStarted ? "uncertain" : "not_started" };
      Object.assign(failure, context);
      mutationFailures.set(failure, context);
    }
    throw failure;
  } finally {
    stopped = true; clearTimeout(timer);
    for (const name of signals) signalSource.removeListener(name, abort);
    signal?.removeEventListener("abort", abort);
    if (admission) admission.password = undefined;
    controller.abort();
  }
}
