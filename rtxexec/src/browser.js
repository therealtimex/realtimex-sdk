import { UsageError } from './error.js';
import { resolveSecrets } from './client.js';

export function parseBrowserArguments(argv) {
  const command = argv[0];
  const options = {};
  let reference;
  let i = 1;
  if (command !== 'browser-tabs') reference = argv[i++];
  const allowed = command === 'browser-tabs' ? ['cdp'] : command === 'browser-fill' ? ['cdp', 'tab', 'field', 'sso'] : ['cdp', 'tab', 'username-selector', 'password-selector', 'submit-selector', 'sso'];
  for (; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    if (!argv[i]?.startsWith('--') || !allowed.includes(key) || (key !== 'field' && options[key] !== undefined) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new UsageError('Invalid browser option. See rtxexec --help.');
    if (key === 'field') {
      const value = argv[i + 1]; const split = value.indexOf('=');
      const field = value.slice(0, split); const selector = value.slice(split + 1);
      if (split < 1 || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field) || !selector || selector.length > 4096 || ['constructor', 'prototype', '__proto__'].includes(field)) throw new UsageError('Use --field fieldName=selector.');
      options.fields ||= [];
      if (options.fields.some((entry) => entry.name === field || entry.selector === selector) || options.fields.length >= 32) throw new UsageError('Use up to 32 distinct fields and selectors.');
      options.fields.push({ name: field, selector });
    } else options[key] = argv[i + 1];
  }
  if (!/^\d{1,5}$/.test(options.cdp || '') || Number(options.cdp) < 1 || Number(options.cdp) > 65535) throw new UsageError('Provide a local CDP port with --cdp.');
  if (command === 'browser-login' && (!reference?.startsWith('secret://') || !/^[a-zA-Z0-9_-]{1,128}$/.test(options.tab || '') || (!options['username-selector'] && !options['password-selector']))) throw new UsageError('Provide a secret reference, --tab from browser-tabs, and at least one username/password selector.');
  if (command === 'browser-fill' && (!reference?.startsWith('secret://') || reference.includes('#') || !/^[a-zA-Z0-9_-]{1,128}$/.test(options.tab || '') || !options.fields?.length)) throw new UsageError('Provide an item reference, --tab and at least one --field name=selector.');
  if (options.sso && (!options.sso.startsWith('secret://') || options.sso.includes('#') || options.sso.length > 1024)) throw new UsageError('Use --sso secret://provider with a linked Login item.');
  return { command, reference, ...options };
}

export async function browserTargets(port, fetchImpl = fetch) {
  const response = await fetchImpl(`http://127.0.0.1:${port}/json/list`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new UsageError('Could not list browser tabs.');
  let targets;
  try { targets = await response.json(); } catch { throw new UsageError('Invalid CDP target response.'); }
  if (!Array.isArray(targets)) throw new UsageError('Invalid CDP target response.');
  return targets.filter((target) => {
    try {
      const url = new URL(target.url);
      return target.type === 'page' && ['http:', 'https:'].includes(url.protocol) && url.pathname !== '/cli-browser/index.html';
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
  const usable = (element) => {
    if (!element || element.disabled || element.matches(':disabled') || element.getClientRects().length === 0) return false;
    const style = getComputedStyle(element);
    if (style.visibility !== 'visible') return false;
    for (let node = element; node; node = node.parentElement) {
      if (Number(getComputedStyle(node).opacity) === 0) return false;
    }
    return true;
  };
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
    if (!sameOrigin() || !submit.isConnected || !usable(submit) || !safeForm(submit) || (submit.formAction && new URL(submit.formAction).origin !== expectedOrigin)) return { error: 'changed' };
    submit.click();
  }
  return { status: submit ? 'submitted' : 'filled' };
}


// Fill-only: submission remains an explicit, separate browser action.
export function fillFields(values, selectors, expectedOrigin) {
  const usable = (element) => {
    if (!element || !element.isConnected || element.disabled || element.matches(':disabled') || element.readOnly || !element.getClientRects().length) return false;
    if (getComputedStyle(element).visibility !== 'visible') return false;
    for (let node = element; node; node = node.parentElement) if (Number(getComputedStyle(node).opacity) === 0) return false;
    return !element.form || new URL(element.form.action || location.href).origin === expectedOrigin;
  };
  if (location.origin !== expectedOrigin) return { error: 'origin' };
  const fields = [];
  for (const { name, selector } of selectors) {
    const matches = document.querySelectorAll(selector);
    const element = matches.length === 1 ? matches[0] : null;
    if (!usable(element) || !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return { error: 'field' };
    if (element instanceof HTMLInputElement && ['file', 'hidden', 'checkbox', 'radio', 'button', 'submit', 'reset', 'image'].includes(element.type)) return { error: 'field' };
    if (name === 'password' && (!(element instanceof HTMLInputElement) || element.type !== 'password')) return { error: 'password-field' };
    if (element instanceof HTMLSelectElement && !Array.from(element.options).some(option => option.value === values[name] && !option.disabled)) return { error: 'option' };
    if (fields.some(entry => entry.element === element)) return { error: 'duplicate' };
    fields.push({ element, name, type: element.type });
  }
  for (const { element, name, type } of fields) {
    if (location.origin !== expectedOrigin || !usable(element) || element.type !== type) return { error: 'changed' };
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, values[name]);
    if (element.value !== values[name]) return { error: 'value' };
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return { status: 'filled' };
}

export async function runBrowser(plan, env, { targets = browserTargets, connect = connectCdp, resolver = resolveSecrets } = {}) {
  const pages = await targets(plan.cdp);
  if (plan.command === 'browser-tabs') return { tabs: pages.map(({ id, url }) => { const clean = new URL(url); clean.search = ''; clean.hash = ''; clean.username = ''; clean.password = ''; return { id, url: clean.href }; }) };
  const target = pages.find(({ id }) => id === plan.tab);
  if (!target) throw new UsageError('Selected browser tab is unavailable. Run browser-tabs again.');
  const cdp = await connect(target.webSocketDebuggerUrl, plan.cdp);
  try {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    let origin;
    try {
      const url = new URL(frameTree?.frame?.url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      origin = url.origin;
    } catch { throw new UsageError('Selected page is not ready. Wait for navigation and run browser-tabs again.'); }
    const { executionContextId } = await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'rtxexec-login' });
    const requested = plan.command === 'browser-fill' ? plan.fields.map(entry => entry.name) : ['username', 'password'].filter(name => plan[`${name}-selector`]);
    const values = await resolver({ references: [plan.reference], command: 'rtxexec', browser: { origin, targetId: target.id, fields: requested, ...(plan.sso ? { ssoReference: plan.sso } : {}) } }, env);
    const credential = values[0];
    const fields = credential?.fields || credential;
    if (requested.some(name => typeof fields?.[name] !== 'string' || !fields[name]) || !Array.isArray(credential?.allowedOrigins) || !credential.allowedOrigins.includes(origin)) throw new UsageError('RealTimeX did not authorize the requested fields for this website.');
    const args = plan.command === 'browser-fill'
      ? [Object.fromEntries(requested.map(name => [name, fields[name]])), plan.fields, origin]
      : [fields.username || '', fields.password || '', { username: plan['username-selector'], password: plan['password-selector'], submit: plan['submit-selector'] }, origin];
    const result = await cdp.send('Runtime.callFunctionOn', {
      executionContextId, functionDeclaration: (plan.command === 'browser-fill' ? fillFields : fillLogin).toString(), returnByValue: true,
      arguments: args.map((value) => ({ value })),
    });
    if (result.exceptionDetails || !['filled', 'submitted'].includes(result.result?.value?.status)) throw new UsageError('Form fill was not completed. Check the selected page, origin and visible form selectors; values were not printed.');
    return { status: result.result.value.status, targetId: target.id, origin };
  } finally { cdp.close(); }
}
