import { UsageError } from "./error.js";
import path from 'node:path';

export function resolveEndpoint(env) {
  const base = env.REALTIMEX_BASE_URL || (env.SERVER_URL ? `${env.SERVER_URL.replace(/\/$/, '')}/cli` : '');
  let url;
  try { url = new URL(base); } catch { throw new UsageError('RealTimeX connection is missing. Run this command in a RealTimeX terminal session.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw new UsageError('rtxexec requires a local RealTimeX server URL.');
  }
  const prefix = url.pathname.replace(/\/$/, '');
  if (!prefix.endsWith('/cli')) throw new UsageError('REALTIMEX_BASE_URL must end with /cli.');
  url.pathname = `${prefix}/secrets/resolve`;
  return url;
}

export async function resolveSecrets(plan, env = process.env, fetchImpl = fetch) {
  const url = resolveEndpoint(env);
  const token = env.REALTIMEX_TERMINAL_SESSION_TOKEN;
  if (!token) throw new UsageError('No terminal session token. Run rtxexec inside RealTimeX.');
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `RealtimeX-Terminal ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ references: plan.references, executable: path.win32.basename(path.basename(plan.command)) }),
    });
  } catch { throw new UsageError('Could not reach RealTimeX. Check that the app is running; no command was launched.'); }
  let text = '';
  try {
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.length;
        if (bytes > 4 * 1024 * 1024) { await reader.cancel(); throw new UsageError(); }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
  } catch { throw new UsageError('Could not read the credential response; no command was launched.'); }
  let body;
  try { body = JSON.parse(text); } catch { throw new UsageError('Invalid RealTimeX response; no command was launched.'); }
  if (!response.ok || body.success !== true) {
    const messages = {
      SECRET_NOT_FOUND: 'A referenced secret does not exist.',
      SECRET_SCOPE_DENIED: 'A referenced secret is not available in this workspace.',
      SECRET_DISABLED: 'A referenced secret is disabled.',
      SECRET_UNDECRYPTABLE: 'A secret cannot be decrypted. Replace its value in Settings > Secrets.',
    };
    throw new UsageError(messages[body.code] || `RealTimeX denied secret resolution (HTTP ${response.status}). Check session authentication and secret settings.`);
  }
  if (!Array.isArray(body.secrets) || body.secrets.length !== plan.references.length || body.secrets.some((item) => !item || !plan.references.includes(item.reference))) throw new UsageError('Invalid RealTimeX credential response.');
  return body.secrets;
}
