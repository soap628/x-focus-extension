import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { newState, reduce } from '../core.js';
import { hudSummary } from '../hud-state.js';

const source = fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
function environment({ account = 'soap628', username = 'soap628', enabled = true, observer = true, invalidated = false } = {}) {
  const window = new EventTarget(), document = new EventTarget();
  document.readyState = 'complete'; document.visibilityState = 'visible';
  const configs = [], commands = [], states = [], timers = new Map();
  let sequence = 0, mutate, listener, loggedIn = account;
  const config = { username, enabled, startedAt: '2026-09-26T00:00:00Z' };
  window.addEventListener('x-focus-config-v2', event => {
    const next = JSON.parse(event.detail); configs.push(next);
    if (!next.ack && observer) window.dispatchEvent(new CustomEvent('x-focus-data-v2', { detail: JSON.stringify({ ready: true, username: next.username, enabled: next.enabled }) }));
  });
  const context = vm.createContext({
    window, document, CustomEvent, location: { pathname: '/home' },
    XFocusHUD: { mount: () => ({ update() {}, setConnection: state => states.push(state) }) },
    XFocusScanner: { loggedInUsername: () => loggedIn, scan: () => ({ username: config.username, followers: null, posts: [], analytics: [] }) },
    MutationObserver: class { constructor(callback) { mutate = callback; } observe() {} },
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, setInterval() {},
    chrome: { runtime: { id: 'test', onMessage: { addListener(callback) { listener = callback; } }, async sendMessage(message) {
      commands.push(message);
      if (invalidated) throw new Error('Extension context invalidated.');
      if (message.type === 'bind') config.username = message.username;
      return { ok: true, config: { ...config } };
    } } }
  });
  vm.runInContext(source, context);
  return {
    configs, commands, states, config,
    status: () => states.at(-1),
    switchAccount(next) { loggedIn = next; mutate(); },
    sendPacket(packet) { window.dispatchEvent(new CustomEvent('x-focus-data-v2', { detail: JSON.stringify(packet) })); },
    scan: () => new Promise(resolve => listener({ type: 'scan' }, {}, resolve)),
    updateConfig(next) { Object.assign(config, next); listener({ type: 'config', config: { ...config } }, {}, () => {}); },
    runTimer(delay) { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); } }
  };
}

test('ready requires the active account and an observer handshake, not just enabled=true', async () => {
  const good = environment(); await settle();
  assert.equal(good.status().status, 'ready');
  const missing = environment({ observer: false }); await settle();
  assert.equal(missing.status().status, 'connecting');
  missing.runTimer(8000);
  assert.equal(missing.status().status, 'error');
  assert.match(missing.status().message, /刷新/);
  missing.sendPacket({ ready: true, username: 'someone_else', enabled: true });
  assert.equal(missing.status().status, 'error', 'a stale handshake cannot approve the current account');
  missing.sendPacket({ ready: true, username: 'soap628', enabled: true });
  assert.equal(missing.status().status, 'ready');
});

test('login detection binds an empty profile once and enables observation only after binding', async () => {
  const e = environment({ account: null, username: '' }); await settle();
  assert.equal(e.status().status, 'waiting-account');
  assert.equal(e.configs.at(-1).enabled, false);
  e.switchAccount('soap628');
  await e.scan(); await settle();
  assert.equal(e.commands.filter(c => c.type === 'bind').length, 1);
  assert.equal(e.configs.at(-1).enabled, true);
  assert.equal(e.status().status, 'ready');
  await e.scan();
  assert.equal(e.commands.filter(c => c.type === 'bind').length, 1);
});

test('switching account suspends this page and rejects packets before the next scan', async () => {
  const e = environment(); await settle();
  e.switchAccount('other_account');
  assert.equal(e.status().status, 'account-mismatch');
  assert.equal(e.configs.at(-1).enabled, false);
  e.sendPacket({ username: 'soap628', packetId: 'late-response', posts: [] });
  await e.scan(); await settle();
  assert.equal(e.commands.filter(c => ['capture', 'network', 'heartbeat'].includes(c.type)).length, 0);
  e.switchAccount('soap628');
  assert.equal(e.status().status, 'ready');
  e.sendPacket({ username: 'soap628', packetId: 'same-account', posts: [] });
  await settle();
  assert.equal(e.commands.filter(c => c.type === 'network').length, 1);
});

test('paused state blocks even a forced scan and reports its state independently of observer readiness', async () => {
  const e = environment({ enabled: false }); await settle();
  assert.equal(e.status().status, 'paused');
  await e.scan();
  assert.equal(e.commands.filter(c => ['capture', 'network', 'heartbeat'].includes(c.type)).length, 0);
  e.updateConfig({ enabled: true });
  assert.equal(e.status().status, 'ready');
});

test('an invalidated extension context tells the page to refresh instead of displaying ready', async () => {
  const e = environment({ invalidated: true }); await settle();
  assert.equal(e.status().status, 'error');
  assert.match(e.status().message, /扩展已更新，请刷新/);
});

test('HUD diagnostics contain only tracking timestamps, without leaking stored post text or notes', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  const state = reduce(newState(), { type: 'settings', username: 'soap628', posts: 2, replies: 10 }, now);
  state.tracking.lastNetworkAt = now.toISOString();
  state.tracking.lastPageAt = now.toISOString();
  state.days['2026-09-26'].note = 'private-note';
  state.posts['123'] = { text: 'private-post' };
  const summary = hudSummary(state, now);
  assert.deepEqual(summary.tracking, { startedAt: now.toISOString(), lastNetworkAt: now.toISOString(), lastPageAt: now.toISOString(), lastPublishAt: null });
  assert.doesNotMatch(JSON.stringify(summary), /private-note|private-post/);
});
