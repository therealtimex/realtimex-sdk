import { UsageError } from './error.js';
import { resolveSecrets } from './client.js';

export function parseBrowserArguments(argv) {
  const command = argv[0];
  const options = {};
  let reference;
  let i = 1;
  if (command === 'browser-login') reference = argv[i++];
  const allowed = command === 'browser-tabs' ? ['cdp'] : ['cdp', 'tab', 'username-selector', 'password-selector', 'submit-selector'];
  for (; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    if (!argv[i]?.startsWith('--') || !allowed.includes(key) || options[key] !== undefined || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new UsageError('Invalid browser option. See rtxexec --help.');
    options[key] = argv[i + 1];
  }
  if (!/^\d{1,5}$/.test(options.cdp || '') || Number(options.cdp) < 1 || Number(options.cdp) > 65535) throw new UsageError('Provide a local CDP port with --cdp.');
  if (command === 'browser-login' && (!reference?.startsWith('secret://') || !/^[a-zA-Z0-9_-]{1,128}$/.test(options.tab || '') || (!options['username-selector'] && !options['password-selector']))) throw new UsageError('Provide a secret reference, --tab from browser-tabs, and at least one username/password selector.');
  return { command, reference, ...options };
}

export async function browserTargets(port, fetchImpl = fetch) {
  const response = await fetchImpl(`http://127.0.0.1:${port}/json/list`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new UsageError('Could not list browser tabs.');
  const targets = await response.json();
  if (!Array.isArray(targets)) throw new UsageError('Invalid CDP target response.');
  return targets.filter((target) => {
    try {
      const url = new URL(target.url);
      return target.type === 'page' && ['http:', 'https:'].includes(url.protocol) && !url.pathname.includes('/cli-browser/index.html');
    } catch { return false; }
  });
}

export async function connectCdp(address, port, WebSocketImpl = globalThis.WebSocket) {
  if (!WebSocketImpl) throw new UsageError('Browser login requires Node.js 22 or newer.');
  const url = new URL(address);
  if (url.protocol !== 'ws:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port !== String(Number(port)) || url.username || url.password) throw new UsageError('CDP must use the selected local browser port.');
  const socket = new WebSocketImpl(url);
  const pending = new Map(); let nextId = 0;
  const rejectAll = () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('CDP connection ended')); } pending.clear(); };
  socket.addEventListener('close', rejectAll);
  socket.addEventListener('error', rejectAll);
  socket.addEventListener('message', ({ data }) => {
    let message; try { message = JSON.parse(data); } catch { return; }
    const entry = pending.get(message.id); if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error('CDP operation failed'));
    else entry.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('CDP connection timeout')); }, 5000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, { once: true });
  });
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP operation timeout')); }, 10000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { rejectAll(); socket.close(); },
  };
}

// Fixed code executed in an isolated world. Values travel only as CDP arguments,
// never interpolated into source or returned to the caller. Top-level forms only.
export function fillLogin(username, password, selectors, expectedOrigin) {
  const sameOrigin = () => location.origin === expectedOrigin;
  const find = (selector) => { if (!selector) return null; const matches = document.querySelectorAll(selector); return matches.length === 1 ? matches[0] : null; };
  const user = find(selectors.username); const pass = find(selectors.password); const submit = find(selectors.submit);
  const fields = [[user, username, selectors.username], [pass, password, selectors.password]];
  const safeForm = (element) => !element?.form || new URL(element.form.action || location.href).origin === expectedOrigin;
  const usable = (element) => element && !element.disabled && element.getClientRects().length > 0;
  if (!sameOrigin()) return { error: 'origin' };
  for (const [element, , selector] of fields) {
    if (!selector) continue;
    if (!(element instanceof HTMLInputElement) || element.readOnly || !usable(element) || !safeForm(element)) return { error: 'field' };
  }
  if (pass && pass.type !== 'password') return { error: 'password-field' };
  if (selectors.submit && (!usable(submit) || !safeForm(submit) || (submit.formAction && new URL(submit.formAction).origin !== expectedOrigin))) return { error: 'submit' };
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  for (const [element, value, selector] of fields) {
    if (!selector) continue;
    if (!sameOrigin() || !element.isConnected || !usable(element) || element.readOnly || (element === pass && element.type !== "password") || !safeForm(element)) return { error: 'changed' };
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (submit) {
    if (!sameOrigin() || !submit.isConnected || !safeForm(submit) || (submit.formAction && new URL(submit.formAction).origin !== expectedOrigin)) return { error: 'changed' };
    submit.click();
  }
  return { status: submit ? 'submitted' : 'filled' };
}

export async function runBrowser(plan, env, { targets = browserTargets, connect = connectCdp, resolver = resolveSecrets } = {}) {
  const pages = await targets(plan.cdp);
  if (plan.command === 'browser-tabs') return { tabs: pages.map(({ id, url }) => { const clean = new URL(url); clean.search = ''; clean.hash = ''; clean.username = ''; clean.password = ''; return { id, url: clean.href }; }) };
  const target = pages.find(({ id }) => id === plan.tab);
  if (!target) throw new UsageError('Selected browser tab is unavailable. Run browser-tabs again.');
  const cdp = await connect(target.webSocketDebuggerUrl, plan.cdp);
  try {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const origin = new URL(frameTree.frame.url).origin;
    const { executionContextId } = await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'rtxexec-login' });
    const values = await resolver({ references: [plan.reference], command: 'rtxexec', browser: { origin, targetId: target.id } }, env);
    const credential = values[0];
    if (typeof credential?.username !== 'string' || !credential.username || typeof credential.password !== 'string' || !credential.password || !Array.isArray(credential.allowedOrigins) || !credential.allowedOrigins.includes(origin)) throw new UsageError('RealTimeX did not authorize a Login credential for this website.');
    const result = await cdp.send('Runtime.callFunctionOn', {
      executionContextId, functionDeclaration: fillLogin.toString(), returnByValue: true,
      arguments: [credential.username, credential.password, { username: plan['username-selector'], password: plan['password-selector'], submit: plan['submit-selector'] }, origin].map((value) => ({ value })),
    });
    if (result.exceptionDetails || !['filled', 'submitted'].includes(result.result?.value?.status)) throw new UsageError('Login was not completed. Check the selected page, origin and visible form selectors; values were not printed.');
    return { status: result.result.value.status, targetId: target.id, origin };
  } finally { cdp.close(); }
}
