import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

const source = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function environment({ pathname = '/home', body = null, enabled = true, account = 'soap628', observer = true, failure = null, beforeResponse = null } = {}) {
  let time = Date.parse('2026-09-26T04:00:00Z'), sequence = 0, mutate, onCommand, listener, scannerCalls = 0;
  const timers = new Map(), messages = [], statuses = [], window = new EventTarget();
  const document = body === null ? new EventTarget() : parseHTML(`<html><body><nav><a data-testid="AppTabBar_Profile_Link" href="/${account}">Profile</a></nav><main>${body}</main></body></html>`).document;
  document.readyState = 'complete'; document.visibilityState = 'visible';
  const config = { username: 'soap628', enabled, startedAt: new Date(time).toISOString() };
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return time; } }
  function addTimer(callback, delay, repeat = false) { const id = ++sequence; timers.set(id, { callback, delay, at: time + delay, repeat }); return id; }
  window.addEventListener('x-focus-config-v2', event => {
    const value = JSON.parse(event.detail);
    if (!value.ack && observer) window.dispatchEvent(new CustomEvent('x-focus-data-v2', { detail: JSON.stringify({ ready: true, username: value.username, enabled: value.enabled }) }));
  });
  const ctx = vm.createContext({ window, document, CustomEvent, URL, Date: ClockDate, location: { pathname },
    MutationObserver: class { constructor(callback) { mutate = callback; } observe() {} },
    setTimeout: (callback, delay) => addTimer(callback, delay), clearTimeout: id => timers.delete(id),
    setInterval: (callback, delay) => addTimer(callback, delay, true),
    XFocusHUD: { mount({ onCommand: handler }) { onCommand = handler; return { update() {}, setConnection(value) { statuses.push(value); } }; } },
    chrome: { runtime: { id: 'test', onMessage: { addListener(fn) { listener = fn; } }, async sendMessage(message) {
      messages.push({ ...message, sentAt: time });
      const reason = typeof failure === 'function' ? failure(message) : failure;
      if (reason) throw new Error(reason);
      if (beforeResponse) await beforeResponse(message);
      return { ok: true, config: { ...config }, hud: { revision: messages.filter(m => ['capture', 'network'].includes(m.type)).length } };
    } } }
  });
  if (body !== null) vm.runInContext(source('scanner.js'), ctx);
  else ctx.XFocusScanner = { loggedInUsername: () => account, scan: () => ({ username: 'soap628', followers: null, posts: [], analytics: [] }) };
  const original = ctx.XFocusScanner.scan;
  ctx.XFocusScanner.scan = (...args) => { scannerCalls++; return original(...args); };
  vm.runInContext(source('content.js'), ctx);
  async function advance(milliseconds) {
    const target = time + milliseconds;
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      const [id, timer] = due; time = timer.at; timers.delete(id);
      if (timer.repeat) timers.set(id, { ...timer, at: time + timer.delay });
      timer.callback(); await flush();
    }
    time = target; await flush();
  }
  return { document, messages, statuses, timers, advance, now: () => time, scans: () => scannerCalls,
    mutate(change = () => {}) { change(); mutate(); },
    command: action => onCommand(action),
    config(next) { Object.assign(config, next); listener({ type: 'config', config: { ...config } }, {}, () => {}); },
    packet(value) { window.dispatchEvent(new CustomEvent('x-focus-data-v2', { detail: JSON.stringify(value) })); }
  };
}

test('published response packets are persisted immediately without waiting for the DOM scan timer', async () => {
  const e = environment(); await flush();
  const before = e.now();
  e.packet({ username: 'soap628', packetId: 'published-1', posts: [{ id: '100', kind: 'posts' }] });
  await flush();
  assert.equal(e.messages.find(message => message.type === 'network').sentAt, before);
  assert.equal(e.scans(), 0, 'the initial DOM delay has not elapsed');
});

test('visible DOM changes are throttled to 1.5 seconds on Analytics and 3.5 seconds elsewhere', async () => {
  for (const [pathname, interval] of [['/home', 3500], ['/i/account_analytics', 1500]]) {
    const e = environment({ pathname }); await flush();
    await e.advance(349); assert.equal(e.scans(), 0);
    await e.advance(1); assert.equal(e.scans(), 1);
    e.mutate();
    for (let i = 0; i < 10; i++) e.mutate();
    await e.advance(interval - 1); assert.equal(e.scans(), 1);
    await e.advance(1); assert.equal(e.scans(), 2, 'a mutation burst schedules a single scan');
  }
});

test('a quiet Analytics page completes its stable range scan after a 2-second retry, without waiting 60 seconds', async () => {
  const e = environment({ pathname: '/i/account_analytics', body: '<button aria-selected="true">2W</button><section><span>Impressions</span><strong>98K</strong></section>' });
  await flush(); await e.advance(350);
  assert.equal(e.messages.filter(m => m.type === 'capture').at(-1).analyticsSummary.period.days, 14);
  e.mutate(() => { e.document.querySelector('button').textContent = '7D'; e.document.querySelector('strong').textContent = '49K'; });
  await e.advance(1500);
  assert.equal(e.messages.filter(m => m.type === 'capture').length, 1, 'new range is still in stability quarantine');
  await e.advance(1999); assert.equal(e.messages.filter(m => m.type === 'capture').length, 1);
  await e.advance(1);
  const saved = e.messages.filter(m => m.type === 'capture').at(-1);
  assert.equal(saved.analyticsSummary.period.days, 7);
  assert.equal(saved.analyticsSummary.impressions.value, 49000);
  assert.equal(e.scans(), 3);
});

test('a stuck loading page receives only three short retries and never saves the previous Today total', async () => {
  const e = environment({ pathname: '/i/account_analytics', body: '<button aria-selected="true">Today</button><div role="progressbar">Loading</div><section><span>Impressions</span><strong>98K</strong></section>' });
  await flush(); await e.advance(350);
  await e.advance(10000);
  assert.equal(e.scans(), 4, 'one initial scan and three bounded 2-second retries');
  assert.equal(e.messages.filter(m => m.type === 'capture').length, 0);
});

test('scan-now is local, returns the freshest HUD and still respects pause and account matching', async () => {
  for (const options of [{ enabled: false }, { account: 'someone' }]) {
    const e = environment(options); await flush();
    const result = await e.command({ command: 'scan-now' });
    assert.equal(result.revision, 0);
    assert.equal(e.scans(), 0);
    assert.equal(e.messages.filter(m => ['capture', 'network', 'heartbeat', 'hud-command'].includes(m.type)).length, 0);
    assert.ok(e.messages.some(m => m.type === 'hud'));
  }
  const e = environment({ pathname: '/soap628', body: '<a href="/soap628/followers">3,043 Followers</a>' }); await flush();
  const result = await e.command({ command: 'scan-now' });
  assert.equal(result.revision, 1);
  assert.equal(e.messages.find(m => m.type === 'capture').followers.value, 3043);
  assert.equal(e.messages.filter(m => m.type === 'hud-command').length, 0, 'scan-now never becomes a background mutation command');
});

test('scan-now cannot bypass a loading guard or relabel unchanged old cards during a period switch', async () => {
  const e = environment({ pathname: '/i/account_analytics', body: '<button aria-selected="true">2W</button><section><span>Impressions</span><strong>98K</strong></section>' });
  await flush(); await e.command({ command: 'scan-now' });
  e.mutate(() => { e.document.querySelector('button').textContent = 'Today'; });
  await e.command({ command: 'scan-now' });
  assert.equal(e.messages.filter(m => m.type === 'capture').length, 1);
  e.document.querySelector('main').setAttribute('aria-busy', 'true');
  await e.command({ command: 'scan-now' });
  assert.equal(e.messages.filter(m => m.type === 'capture').length, 1);
});

test('connection codes stay stable across locales and mismatch params retain both account names', async () => {
  const cases = [
    [{}, 'ready'], [{ enabled: false }, 'paused'], [{ account: 'someone' }, 'mismatch'], [{ account: null }, 'identity'],
    [{ observer: false }, 'handshake'], [{ failure: 'network unavailable' }, 'transport'], [{ failure: 'Extension context invalidated.' }, 'stopped']
  ];
  for (const [options, code] of cases) {
    const e = environment(options); await flush();
    assert.equal(e.statuses.at(-1).code, code);
    assert.equal(typeof e.statuses.at(-1).message, 'string');
    if (code === 'mismatch') { assert.equal(e.statuses.at(-1).params.active, 'someone'); assert.equal(e.statuses.at(-1).params.bound, 'soap628'); }
  }
  const missing = environment({ observer: false }); await flush(); await missing.advance(8000);
  assert.equal(missing.statuses.at(-1).code, 'handshake-timeout');
});

test('a static visible page still receives the 60-second fallback scan while hidden DOM scans stay suspended', async () => {
  const visible = environment(); await flush(); await visible.advance(60350);
  assert.equal(visible.scans(), 2);
  const hidden = environment(); hidden.document.visibilityState = 'hidden'; await flush(); await hidden.advance(60350);
  assert.equal(hidden.scans(), 0);
});

test('unchanged visible captures are deduplicated briefly but reobserved by the 60-second fallback', async () => {
  const e = environment({ pathname: '/soap628', body: '<a href="/soap628/followers">3,043 Followers</a>' });
  await flush(); await e.advance(350);
  assert.equal(e.messages.filter(m => m.type === 'capture').length, 1);
  e.mutate(); await e.advance(3500);
  assert.equal(e.messages.filter(m => m.type === 'capture').length, 1, 'the same DOM within 30 seconds is deduplicated');
  await e.advance(56500);
  const captures = e.messages.filter(m => m.type === 'capture');
  assert.equal(captures.length, 2, 'the minute fallback sends a fresh observation even when its value is unchanged');
  assert.equal(captures[1].followers.value, 3043);
  assert.equal(captures[1].sentAt - captures[0].sentAt, 60000);
});

test('a repeated Analytics total is eligible again once its successful capture cache reaches 30 seconds', async () => {
  const e = environment({ pathname: '/i/account_analytics', body: '<button aria-selected="true">7D</button><section><span>Impressions</span><strong>93.4K</strong></section>' });
  await flush(); await e.advance(350);
  await e.advance(28000);
  e.mutate(); await e.advance(350);
  assert.equal(e.messages.filter(m => m.type === 'capture').length, 1);
  await e.advance(1300); e.mutate(); await e.advance(350);
  const captures = e.messages.filter(m => m.type === 'capture');
  assert.equal(captures.length, 2);
  assert.equal(captures[1].analyticsSummary.impressions.value, 93400);
});

test('signature expiry never makes hidden or paused pages emit captures', async () => {
  for (const mode of ['hidden', 'paused']) {
    const e = environment({ pathname: '/soap628', body: '<a href="/soap628/followers">3,043 Followers</a>' });
    await flush(); await e.advance(350);
    if (mode === 'hidden') e.document.visibilityState = 'hidden';
    else e.config({ enabled: false });
    e.mutate(); await e.advance(120000);
    assert.equal(e.messages.filter(m => m.type === 'capture').length, 1, mode);
  }
});

test('failed captures do not seed or extend the signature cache, and forced scans bypass a fresh cache', async () => {
  let failures = 1;
  const e = environment({ pathname: '/soap628', body: '<a href="/soap628/followers">3,043 Followers</a>', failure: message => message.type === 'capture' && failures-- > 0 ? 'temporary storage error' : null });
  await flush(); await e.advance(350);
  assert.equal(e.messages.filter(m => m.type === 'capture').length, 1);
  e.mutate(); await e.advance(3500);
  assert.equal(e.messages.filter(m => m.type === 'capture').length, 2, 'an unchanged failed capture is retried before 30 seconds');
  await e.command({ command: 'scan-now' });
  assert.equal(e.messages.filter(m => m.type === 'capture').length, 3, 'manual scan bypasses the newly successful cache');
});

test('DOM changes during a slow save coalesce into one normally throttled follow-up scan', async () => {
  let releaseSave, holdFirst = true;
  const e = environment({ pathname: '/i/account_analytics', body: '<button aria-selected="true">7D</button><section><span>Impressions</span><strong>98K</strong></section>', beforeResponse: async message => {
    if (message.type === 'capture' && holdFirst) { holdFirst = false; await new Promise(resolve => { releaseSave = resolve; }); }
  } });
  await flush(); await e.advance(350);
  assert.equal(e.scans(), 1);
  for (const value of ['99K', '100K', '101K']) {
    e.mutate(() => { e.document.querySelector('strong').textContent = value; });
    await e.advance(1500);
  }
  assert.equal(e.scans(), 1, 'there is only one active collection while storage is responding');
  releaseSave(); await flush();
  await e.advance(1499);
  assert.equal(e.scans(), 1, 'the follow-up retains the Analytics throttle');
  await e.advance(1);
  const captures = e.messages.filter(m => m.type === 'capture');
  assert.equal(e.scans(), 2);
  assert.equal(captures.length, 2);
  assert.equal(captures[1].analyticsSummary.impressions.value, 101000);
  await e.advance(10000);
  assert.equal(e.scans(), 2, 'coalesced changes do not leave a recursive scan loop');
});

test('a queued scan after a slow save is discarded if the page was hidden or tracking paused', async () => {
  for (const mode of ['hidden', 'paused']) {
    let releaseSave, holdFirst = true;
    const e = environment({ pathname: '/i/account_analytics', body: '<button aria-selected="true">7D</button><section><span>Impressions</span><strong>98K</strong></section>', beforeResponse: async message => {
      if (message.type === 'capture' && holdFirst) { holdFirst = false; await new Promise(resolve => { releaseSave = resolve; }); }
    } });
    await flush(); await e.advance(350);
    e.mutate(() => { e.document.querySelector('strong').textContent = '99K'; });
    await e.advance(1500);
    if (mode === 'hidden') e.document.visibilityState = 'hidden';
    else e.config({ enabled: false });
    releaseSave(); await flush(); await e.advance(10000);
    assert.equal(e.scans(), 1, mode);
    assert.equal(e.messages.filter(m => m.type === 'capture').length, 1, mode);
  }
});

test('a configuration broadcast during capture cannot create a self-sustaining collection loop', async () => {
  const e = environment({ pathname: '/i/account_analytics', body: '<button aria-selected="true">7D</button><section><span>Impressions</span><strong>93.4K</strong></section>', beforeResponse: async message => {
    if (message.type === 'capture') e.config({});
  } });
  await flush(); await e.advance(10000);
  assert.equal(e.messages.filter(m => m.type === 'capture').length, 1);
  assert.equal(e.scans(), 2, 'only the original scan and the broadcast-triggered deduplicated scan run');
  assert.deepEqual([...e.timers.values()].map(timer => timer.delay), [60000]);
});
