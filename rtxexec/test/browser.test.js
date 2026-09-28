import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { parseBrowserArguments, browserTargets, runBrowser, fillLogin, connectCdp } from '../src/browser.js';

const args = ['browser-login', 'secret://login', '--cdp', '9235', '--tab', 'target-1', '--username-selector', '#user', '--password-selector', '#pass'];
const plan = parseBrowserArguments(args);
const credential = { username: "user'\n😃", password: 'secret"\\\n123', allowedOrigins: ['https://example.com'] };

function harness(result = { result: { value: { status: 'filled' } } }) {
  const calls = []; let closed = false;
  return { calls, get closed() { return closed; },
    targets: async () => [{ id: 'target-1', webSocketDebuggerUrl: 'ws://127.0.0.1:9235/devtools/page/target-1' }],
    connect: async () => ({ close() { closed = true; }, async send(method, params) { calls.push({ method, params }); if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame-1', url: 'https://example.com/login' } } }; if (method === 'Page.createIsolatedWorld') return { executionContextId: 42 }; return result; } }),
    resolver: async (request) => { calls.push({ request }); return [credential]; },
  };
}

test('browser parser requires explicit port, target and fields and supports multi-step forms', () => {
  assert.equal(plan.reference, 'secret://login');
  assert.equal(parseBrowserArguments(args.slice(0, -2))['password-selector'], undefined);
  for (const bad of [args.slice(0, 2), [...args, '--cdp', '9999'], [...args, '--password', 'raw'], ['browser-tabs', '--cdp', 'https://example.com']]) assert.throws(() => parseBrowserArguments(bad));
});

test('tab listing excludes shell and file targets and strips query/fragment', async () => {
  const tabs = [{ type: 'page', id: 'ok', url: 'https://example.com/login?private=1#secret' }, { type: 'page', url: 'file:///private.pdf' }, { type: 'page', url: 'http://localhost/cli-browser/index.html' }, { type: 'service_worker', url: 'https://example.com' }];
  const filtered = await browserTargets('9235', async () => ({ ok: true, json: async () => tabs }));
  assert.equal(filtered.length, 1);
  const result = await runBrowser({ command: 'browser-tabs', cdp: '9235' }, {}, { targets: async () => filtered });
  assert.deepEqual(result.tabs, [{ id: 'ok', url: 'https://example.com/login' }]);
});

test('browser resolves only the selected target and passes credentials as data in an isolated context', async () => {
  const h = harness(); const output = await runBrowser(plan, {}, h);
  assert.equal(output.status, 'filled'); assert.ok(h.closed);
  const request = h.calls.find((call) => call.request).request;
  assert.deepEqual(request.browser, { origin: 'https://example.com', targetId: 'target-1' });
  const invocation = h.calls.find((call) => call.method === 'Runtime.callFunctionOn').params;
  assert.equal(invocation.executionContextId, 42);
  assert.equal(invocation.arguments[0].value, credential.username);
  assert.equal(invocation.arguments[1].value, credential.password);
  for (const value of [credential.username, credential.password]) { assert.ok(!invocation.functionDeclaration.includes(value)); assert.ok(!JSON.stringify(output).includes(value)); }
});

test('missing target, denied credential and browser exceptions cannot produce a successful fill', async () => {
  const h = harness();
  await assert.rejects(runBrowser({ ...plan, tab: 'missing' }, {}, h)); assert.equal(h.calls.length, 0);
  h.resolver = async () => [{ ...credential, allowedOrigins: ['https://other.com'] }];
  await assert.rejects(runBrowser(plan, {}, h)); assert.ok(h.closed);
  assert.ok(!h.calls.some((call) => call.method === 'Runtime.callFunctionOn'));
  const errors = harness({ exceptionDetails: { text: credential.password } });
  await assert.rejects(runBrowser(plan, {}, errors), (error) => !error.message.includes(credential.password)); assert.ok(errors.closed);
});

test('CDP cannot redirect the connection outside the selected local port', async () => {
  const Socket = class { constructor() { assert.fail('must reject before opening socket'); } };
  await assert.rejects(connectCdp('ws://evil.com:9235/x', '9235', Socket), /selected local browser port/);
  await assert.rejects(connectCdp('ws://127.0.0.1:9222/x', '9235', Socket), /selected local browser port/);
});

function page({ origin = 'https://example.com', action = origin, passType = 'password', onInput, withSubmit = false } = {}) {
  class Input {
    constructor(type) { this.type = type; this.form = { action }; this.isConnected = true; }
    set value(value) { this.saved = value; }
    get value() { return this.saved; }
    matches() { return false; }
    getClientRects() { return [1]; }
    click() { this.clicked = true; }
    dispatchEvent(event) { if (event.type === 'input') onInput?.(this); }
  }
  const user = new Input('text'); const pass = new Input(passType); const submit = new Input('submit');
  const context = { getComputedStyle: (element) => ({ visibility: 'visible', opacity: '1', ...element.style }), HTMLInputElement: Input, URL, Event: class { constructor(type) { this.type = type; } }, location: { origin, href: `${origin}/login` }, document: { querySelectorAll(selector) { const item = { '#user': user, '#pass': pass, '#submit': submit }[selector]; return item ? [item] : []; } } };
  const fill = vm.runInNewContext(`(${fillLogin.toString()})`, context);
  return { user, pass, submit, context, fill: () => fill(credential.username, credential.password, { username: '#user', password: '#pass', submit: withSubmit ? '#submit' : undefined }, 'https://example.com') };
}

test('form filling preserves exact values and dispatches events without returning values', () => {
  const p = page(); assert.equal(p.fill().status, 'filled');
  assert.equal(p.user.value, credential.username); assert.equal(p.pass.value, credential.password);
});

test('wrong origins, cross-origin form actions and unmasked password inputs are rejected before filling', () => {
  for (const options of [{ origin: 'https://evil.com' }, { action: 'https://evil.com' }, { passType: 'text' }]) {
    const p = page(options); assert.ok(p.fill().error); assert.equal(p.user.value, undefined); assert.equal(p.pass.value, undefined);
  }
});

test('origin change after username input prevents password filling', () => {
  const p = page({ onInput: () => { p.context.location.origin = 'https://evil.com'; } });
  assert.equal(p.fill().error, 'changed'); assert.equal(p.pass.value, undefined);
});


test('CSS-hidden fields and transparent ancestors are rejected before writing either value', () => {
  for (const style of [{ visibility: 'hidden' }, { visibility: 'collapse' }, { opacity: '0' }]) {
    const p = page(); p.pass.style = style;
    assert.equal(p.fill().error, 'field'); assert.equal(p.user.value, undefined);
  }
  const p = page(); p.pass.parentElement = { style: { opacity: '0' } };
  assert.equal(p.fill().error, 'field'); assert.equal(p.pass.value, undefined);
});

test('submit succeeds only for a visible connected same-origin control', async () => {
  const parsed = parseBrowserArguments([...args, '--submit-selector', '#submit']);
  assert.equal(parsed['submit-selector'], '#submit');
  assert.equal((await runBrowser(parsed, {}, harness({ result: { value: { status: 'submitted' } } }))).status, 'submitted');
  const p = page({ withSubmit: true });
  assert.equal(p.fill().status, 'submitted'); assert.equal(p.submit.clicked, true);
  const bad = page({ withSubmit: true }); bad.submit.formAction = 'https://other.com/login';
  assert.equal(bad.fill().error, 'submit'); assert.equal(bad.user.value, undefined);
  for (const change of [(button) => { button.isConnected = false; }, (button) => { button.style = { opacity: '0' }; }]) {
    const changed = page({ withSubmit: true, onInput: () => change(changed.submit) });
    assert.equal(changed.fill().error, 'changed'); assert.equal(changed.submit.clicked, undefined);
  }
});

test('tab listing retains similar paths and reports invalid CDP JSON safely', async () => {
  const tabs = await browserTargets('9235', async () => ({ ok: true, json: async () => [{ type: 'page', url: 'https://example.com/docs/cli-browser/index.html' }] }));
  assert.equal(tabs.length, 1);
  await assert.rejects(browserTargets('9235', async () => ({ ok: true, json: async () => { throw new Error('private response'); } })), /Invalid CDP target response/);
});
