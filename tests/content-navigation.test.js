import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

const source = fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

// Exercise content-script navigation and scheduling with a real synthetic DOM.
// The small view double implements the HUD's reattach/reveal contract; HUD tests
// separately verify its layout, persisted preferences and actual controls.
function setup({ enabled = true, account = 'soap628', visible = true } = {}) {
  const { document } = parseHTML('<html><body><nav></nav><main>X page</main></body></html>');
  document.readyState = 'complete'; document.visibilityState = visible ? 'visible' : 'hidden';
  let currentAccount = account, time = Date.parse('2026-10-03T04:00:00Z'), sequence = 0;
  let mutations, messageListener, mounts = 0, reveals = 0, layouts = 0, observations = 0;
  const messages = [], scans = [], timers = new Map(), window = new EventTarget();
  window.navigation = new EventTarget();
  window.history = { pushState() {}, replaceState() {} };
  const historyMethods = { ...window.history };
  const location = { pathname: '/home', search: '', hash: '' };
  const config = { username: 'soap628', enabled, startedAt: new Date(time).toISOString() };
  const savedSummary = { username: 'soap628', posts: 2, replies: 9, totalXp: 219,
    hudPreferences: { mode: 'mini', position: { anchor: 'left', x: 0, y: .3 } } };
  let host, model, status, full = false;
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return time; } }
  const timer = (callback, delay, repeat = false) => { const id = ++sequence; timers.set(id, { callback, delay, at: time + delay, repeat }); return id; };
  window.addEventListener('x-focus-config-v2', event => {
    const packet = JSON.parse(event.detail);
    if (!packet.ack) window.dispatchEvent(new CustomEvent('x-focus-data-v2', { detail: JSON.stringify({ ready: true, username: packet.username, enabled: packet.enabled }) }));
  });
  const context = vm.createContext({ window, document, location, CustomEvent, Date: ClockDate,
    MutationObserver: class { constructor(callback) { mutations = callback; } observe() { observations++; } },
    setTimeout: (callback, delay) => timer(callback, delay), clearTimeout: id => timers.delete(id),
    setInterval: (callback, delay) => timer(callback, delay, true),
    XFocusScanner: { loggedInUsername: () => currentAccount, scan(doc, username, pathname) {
      scans.push(pathname); return { username, followers: { value: 3784, approximate: false }, posts: [], analytics: [] };
    } },
    XFocusHUD: { mount() {
      mounts++; host = document.createElement('div'); host.id = 'x-focus-hud'; document.body.append(host);
      return {
        update(next) { model = next; host.textContent = `${next.posts}/${next.replies}/${next.totalXp}`; },
        setConnection(next) { status = next; },
        layout() { layouts++; },
        ensureConnected() { if (!host.isConnected) { (document.body || document.documentElement).append(host); return true; } return false; },
        reveal() { reveals++; full = true; }
      };
    } },
    chrome: { runtime: { id: 'test', onMessage: { addListener(fn) { messageListener = fn; } }, async sendMessage(message) {
      messages.push(message); return { ok: true, config: { ...config }, hud: savedSummary };
    } } }
  });
  vm.runInContext(source, context);
  async function advance(ms) {
    const target = time + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, item]) => item.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      const [id, item] = due; time = item.at; timers.delete(id);
      if (item.repeat) timers.set(id, { ...item, at: time + item.delay });
      item.callback(); await flush();
    }
    time = target; await flush();
  }
  return { document, window, location, messages, scans, timers, advance, historyMethods, savedSummary,
    host: () => host, model: () => model, status: () => status, mounts: () => mounts, reveals: () => reveals,
    layouts: () => layouts, observations: () => observations, full: () => full,
    mutate() { mutations(); },
    navigate(path, event = 'currententrychange') { location.pathname = path; (event === 'currententrychange' ? window.navigation : window).dispatchEvent(new Event(event)); },
    config(next) { Object.assign(config, next); messageListener({ type: 'config', config: { ...config } }, {}, () => {}); },
    account(next) { currentAccount = next; },
    toolbar() { let response; messageListener({ type: 'hud-toggle' }, {}, value => { response = value; }); return response; }
  };
}

test('a detached HUD is reattached as the same instance with its existing model and one observer', async () => {
  const e = setup(); await flush(); await e.advance(350);
  const original = e.host(), model = e.model();
  original.remove(); assert.equal(original.isConnected, false);
  e.mutate();
  assert.equal(original.isConnected, true);
  assert.equal(e.document.getElementById('x-focus-hud'), original);
  assert.equal(e.model(), model);
  assert.equal(original.textContent, '2/9/219');
  for (let i = 0; i < 20; i++) { original.remove(); e.mutate(); }
  assert.equal(e.mounts(), 1);
  assert.equal(e.observations(), 1);
  assert.equal(e.document.querySelectorAll('#x-focus-hud').length, 1);
  assert.equal([...e.timers.values()].filter(item => item.repeat).length, 1);
});

test('replacing the page body recovers the HUD without clearing saved position or progress', async () => {
  const e = setup(); await flush();
  const original = e.host(), before = JSON.stringify(e.model());
  const nextBody = e.document.createElement('body'); nextBody.innerHTML = '<main>New route</main>';
  e.document.body.replaceWith(nextBody); e.location.pathname = '/notifications'; e.mutate();
  assert.equal(original.parentNode, nextBody);
  assert.equal(e.mounts(), 1);
  assert.equal(JSON.stringify(e.model()), before);
  assert.equal(e.model().hudPreferences.position.anchor, 'left');
  assert.equal(e.layouts(), 1, 'the existing layout is reconciled for the new route');
  await e.advance(350);
  assert.equal(e.scans.at(-1), '/notifications');
});

test('SPA and browser navigation schedule current-route collection without modifying History', async () => {
  for (const event of ['currententrychange', 'popstate', 'hashchange', 'pageshow', 'mutation']) {
    const e = setup(); await flush(); await e.advance(350);
    if (event === 'mutation') { e.location.pathname = '/soap628'; e.mutate(); }
    else e.navigate('/soap628', event);
    for (let i = 0; i < 5; i++) e.mutate();
    await e.advance(3500);
    assert.deepEqual(e.scans, ['/home', '/soap628'], event);
    assert.equal(e.messages.filter(message => message.type === 'capture').length, 2, 'a new route is not masked by the previous page signature');
    assert.equal(e.layouts(), 1, 'same-route mutation bursts do not repeatedly force layout');
    assert.equal(e.window.history.pushState, e.historyMethods.pushState);
    assert.equal(e.window.history.replaceState, e.historyMethods.replaceState);
  }
});

test('query-only navigation is noticed and read again without remounting the HUD', async () => {
  const e = setup(); await flush(); await e.advance(350);
  e.location.search = '?tab=replies'; e.navigate('/home');
  await e.advance(3500);
  assert.equal(e.messages.filter(message => message.type === 'capture').length, 2);
  assert.equal(e.mounts(), 1);
});

test('navigation recovery retains hidden, paused and account-mismatch capture guards', async () => {
  for (const mode of ['hidden', 'paused', 'mismatch', 'identity']) {
    const e = setup(); await flush(); await e.advance(350);
    const before = e.messages.filter(message => ['capture', 'heartbeat', 'network'].includes(message.type)).length;
    if (mode === 'hidden') e.document.visibilityState = 'hidden';
    if (mode === 'paused') e.config({ enabled: false });
    if (mode === 'mismatch') e.account('someone_else');
    if (mode === 'identity') e.account(null);
    e.host().remove(); e.navigate('/notifications'); e.mutate(); await e.advance(10000);
    assert.equal(e.host().isConnected, true, mode);
    assert.equal(e.scans.length, 1, mode);
    assert.equal(e.messages.filter(message => ['capture', 'heartbeat', 'network'].includes(message.type)).length, before, mode);
    if (mode !== 'hidden') assert.equal(e.status().code, mode === 'paused' ? 'paused' : mode === 'mismatch' ? 'mismatch' : 'identity');
  }
});

test('toolbar clicks reveal the existing panel repeatedly and recover detached views without toggling away', async () => {
  const e = setup(); await flush();
  const before = JSON.stringify(e.model()); e.host().remove();
  for (let i = 0; i < 3; i++) {
    assert.equal(e.toolbar().ok, true);
    assert.equal(e.full(), true);
    assert.equal(e.host().isConnected, true);
  }
  assert.equal(e.reveals(), 3);
  assert.equal(e.mounts(), 1);
  assert.equal(JSON.stringify(e.model()), before);
  assert.equal(e.messages.filter(message => ['capture', 'hud-command', 'bind'].includes(message.type)).length, 0);
});
