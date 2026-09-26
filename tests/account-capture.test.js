import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { parseHTML } from 'linkedom';

const script = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const context = vm.createContext({ URL });
vm.runInContext(script('scanner.js'), context);
vm.runInContext(script('network-parser.js'), context);
const { scan, scanAccountMetrics } = context.XFocusScanner;
const parser = context.XFocusNetwork;
const now = new Date('2026-09-26T04:00:00Z');
const route = '/i/account_analytics';
const documentFor = body => parseHTML(`<html><body><nav><a data-testid="AppTabBar_Profile_Link" href="/soap628">Profile</a></nav><main>${body}</main></body></html>`).document;
const card = (label, value) => `<div class="metric"><div><span>${label}</span></div><div>${value}</div></div>`;
const cards = () => `<div class="cards">${card('Checkmark followers', '<span>2.2K</span><span> / 3K</span>')}${card('Impressions', '<strong>98K</strong><span>↑7K%</span>')}${card('Engagements', '<strong>3.2K</strong><span>↑31K%</span>')}${card('Profile visits', '<strong>1.1K</strong><span>↑18K%</span>')}</div>`;

test('X analytics cards retain the selected 2W period and ignore denominators and growth percentages', () => {
  const doc = documentFor(`<div><button>7D</button><button aria-pressed="true">2W</button><button>4W</button></div>${cards()}`);
  const result = scan(doc, 'soap628', route);
  assert.equal(result.verifiedFollowers.value, 2200);
  assert.equal(result.verifiedFollowers.approximate, true);
  assert.equal(result.analyticsSummary.period.days, 14);
  assert.equal(result.analyticsSummary.period.start, null);
  assert.equal(result.analyticsSummary.impressions.value, 98000);
  assert.equal(result.analyticsSummary.engagements.value, 3200);
  assert.equal(result.analyticsSummary.profileVisits.value, 1100);
  assert.equal(result.analytics.length, 0, 'a 2W total must never become today’s exposure');
});

test('an SVG arrow with a separately rendered growth percentage does not replace the card value', () => {
  const doc = documentFor(`<button aria-selected="true">7D</button>${card('Impressions', '<span>98K</span><div><svg><path d=""/></svg><span>7K%</span></div>')}${card('Engagements', '<span>3,240</span><div><svg/><span>31K%</span></div>')}`);
  const result = scanAccountMetrics(doc, 'soap628', route, now);
  assert.equal(result.analyticsSummary.impressions.value, 98000);
  assert.equal(result.analyticsSummary.engagements.value, 3240);
  assert.equal(result.analyticsSummary.engagements.approximate, false);
});

test('verified followers can be read without a period, but monthly/yearly or missing periods remain unknown', () => {
  for (const selection of ['', '<button aria-selected="true">3M</button>', '<button data-state="active">1Y</button>']) {
    const result = scanAccountMetrics(documentFor(`${selection}${cards()}`), 'soap628', route, now);
    assert.equal(result.verifiedFollowers.value, 2200);
    assert.equal(result.analyticsSummary, undefined);
  }
});

test('mismatched accounts, unrelated pages and Verified filter badges cannot become own-account metrics', () => {
  const doc = documentFor(`<button aria-pressed="true">Verified</button><button aria-selected="true">2W</button>${cards()}<article><span>Someone</span><svg data-testid="icon-verified"/></article>`);
  assert.equal(Object.keys(scanAccountMetrics(doc, 'someone', route, now)).length, 0);
  assert.equal(Object.keys(scanAccountMetrics(doc, 'soap628', '/home', now)).length, 0);
  assert.equal(scan(doc, 'soap628', route).blueVerified, undefined, 'DOM badges do not prove an is_blue_verified status');
});

test('full explicit date ranges have exact inclusive day counts; ambiguous or invalid ranges do not', () => {
  const result = scanAccountMetrics(documentFor(`<button aria-selected="true">2026-09-13 – 2026-09-26</button>${cards()}`), 'soap628', route, now);
  assert.equal(result.analyticsSummary.period.days, 14);
  assert.equal(result.analyticsSummary.period.start, '2026-09-13');
  assert.equal(result.analyticsSummary.period.end, '2026-09-26');
  for (const range of ['Sep 13 – Sep 26', '2026-02-30 – 2026-03-02', '2026-09-26 – 2026-10-01']) {
    const invalid = scanAccountMetrics(documentFor(`<button aria-selected="true">${range}</button>${cards()}`), 'soap628', route, now);
    assert.equal(invalid.analyticsSummary, undefined);
  }
});

test('the plain X period pills require a unique bright selection within one group', () => {
  const doc = documentFor(`<div><button data-color="rgb(0, 0, 0)">7D</button><button data-color="rgb(239, 243, 244)">2W</button><button data-color="rgba(0, 0, 0, 0)">4W</button><button data-color="rgb(0, 0, 0)">3M</button></div>${cards()}`);
  doc.defaultView.getComputedStyle = node => ({ backgroundColor: node.getAttribute('data-color') });
  assert.equal(scanAccountMetrics(doc, 'soap628', route, now).analyticsSummary.period.days, 14);
  doc.querySelector('button').setAttribute('data-color', 'rgb(255, 255, 255)');
  assert.equal(scanAccountMetrics(doc, 'soap628', route, now).analyticsSummary, undefined);
  for (const button of doc.querySelectorAll('button')) button.setAttribute('data-color', button.textContent === '3M' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)');
  assert.equal(scanAccountMetrics(doc, 'soap628', route, now).analyticsSummary, undefined);
});

test('a growth-only card, duplicate contradictory values and graph tick labels are not metrics', () => {
  for (const value of ['<span>↑7K%</span>', '<svg><text>60K</text></svg>']) {
    const result = scanAccountMetrics(documentFor(`<button aria-pressed="true">7D</button>${card('Impressions', value)}${card('Engagements', '3.2K')}`), 'soap628', route, now);
    assert.equal(result.analyticsSummary.impressions, undefined);
    assert.equal(result.analyticsSummary.engagements.value, 3200);
  }
  const conflicting = scanAccountMetrics(documentFor(`<button aria-selected="true">2W</button>${card('Impressions', '98K')}${card('Impressions', '100K')}`), 'soap628', route, now);
  assert.equal(conflicting.analyticsSummary, undefined);
});

test('only a matching GraphQL User’s explicit is_blue_verified boolean identifies own blue status', () => {
  const profile = extra => ({ data: { user: { result: { __typename: 'User', core: { screen_name: 'soap628' }, ...extra } } } });
  assert.equal(parser.parse(profile({ is_blue_verified: true }), 'UserByScreenName', 'soap628').blueVerified, true);
  assert.equal(parser.parse(profile({ is_blue_verified: false }), 'UserByScreenName', 'soap628').blueVerified, false);
  assert.equal(parser.parse(profile({ legacy: { verified: true } }), 'UserByScreenName', 'soap628').blueVerified, undefined);
  assert.equal(parser.parse(profile({ is_blue_verified: 'true' }), 'UserByScreenName', 'soap628').blueVerified, undefined);
  assert.equal(parser.parse(profile({ is_blue_verified: true }), 'UserByScreenName', 'someone').blueVerified, undefined);
  const others = { data: { users: [{ core: { screen_name: 'someone' }, is_blue_verified: true }, { legacy: { screen_name: 'soap628', verified: true } }] } };
  assert.equal(parser.parse(others, 'HomeTimeline', 'soap628').blueVerified, undefined);
});

test('blue-only network observations pass through the passive observer and isolated content bridge', async () => {
  const window = new EventTarget(), packets = [], messages = [];
  const body = { data: { user: { result: { __typename: 'User', core: { screen_name: 'soap628' }, is_blue_verified: false } } } };
  window.fetch = () => Promise.resolve(new Response(JSON.stringify(body)));
  window.addEventListener('x-focus-data-v2', event => { const packet = JSON.parse(event.detail); if (packet.packetId) packets.push(packet); });
  class XHR { open() {} send() {} }
  const document = new EventTarget(); document.visibilityState = 'visible';
  const config = { username: 'soap628', enabled: true, startedAt: now.toISOString() };
  const ctx = vm.createContext({ window, document, URL, CustomEvent, crypto: webcrypto, XMLHttpRequest: XHR,
    location: { pathname: '/home' }, MutationObserver: class { observe() {} }, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
    XFocusScanner: { loggedInUsername: () => 'soap628' },
    chrome: { runtime: { id: 'test', onMessage: { addListener() {} }, async sendMessage(message) { messages.push(message); return { ok: true, config }; } } }
  });
  vm.runInContext(script('network-parser.js'), ctx);
  vm.runInContext(script('page-observer.js'), ctx);
  vm.runInContext(script('content.js'), ctx);
  await new Promise(resolve => setImmediate(resolve));
  await window.fetch('https://x.com/i/api/graphql/hash/UserByScreenName');
  for (let i = 0; i < 30 && !messages.some(message => message.type === 'network'); i++) await new Promise(resolve => setTimeout(resolve, 5));
  const saved = messages.find(message => message.type === 'network');
  assert.ok(saved);
  assert.equal(saved.blueVerified, false);
  assert.equal(saved.posts.length, 0);
  assert.equal(packets.length, 1);
});

test('content collection persists new account-only capture fields even when there are no posts or followers', async () => {
  const document = new EventTarget(), window = new EventTarget(), messages = [];
  document.visibilityState = 'visible';
  let listener;
  const capture = { username: 'soap628', followers: null, posts: [], analytics: [], verifiedFollowers: { value: 2200, approximate: true }, analyticsSummary: { period: { label: '2W', days: 14, start: null, end: null }, impressions: { value: 98000, approximate: true } } };
  const config = { username: 'soap628', enabled: true, startedAt: now.toISOString() };
  const ctx = vm.createContext({ document, window, CustomEvent, location: { pathname: route }, MutationObserver: class { observe() {} }, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
    XFocusScanner: { loggedInUsername: () => 'soap628', scan: () => capture },
    chrome: { runtime: { id: 'test', onMessage: { addListener(fn) { listener = fn; } }, async sendMessage(message) { messages.push(message); return { ok: true, config }; } } }
  });
  vm.runInContext(script('content.js'), ctx);
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => listener({ type: 'scan' }, {}, resolve));
  const saved = messages.find(message => message.type === 'capture');
  assert.ok(saved);
  assert.equal(saved.verifiedFollowers.value, 2200);
  assert.equal(saved.analyticsSummary.period.days, 14);
});

test('visible loading indicators block both period totals and today impressions until a stable completed scan', () => {
  const doc = documentFor(`<button aria-selected="true">Today</button><div role="progressbar">Loading</div>${card('Impressions', '<strong>98K</strong>')}`);
  doc.querySelector('main').setAttribute('aria-busy', 'true');
  const first = scan(doc, 'soap628', route, now);
  assert.equal(first.analytics.length, 0);
  assert.equal(first.analyticsSummary, undefined);
  doc.querySelector('main').removeAttribute('aria-busy');
  doc.querySelector('[role="progressbar"]').remove();
  doc.querySelector('strong').textContent = '250';
  const loadedAt = new Date(now.getTime() + 2000);
  assert.equal(scan(doc, 'soap628', route, loadedAt).analytics.length, 0);
  const settled = scan(doc, 'soap628', route, new Date(loadedAt.getTime() + 1600));
  assert.equal(settled.analytics[0].value, 250);
  assert.equal(settled.analyticsSummary.impressions.value, 250);
});

test('a changed period never labels unchanged old cards as the new period without loading evidence', () => {
  const doc = documentFor(`<button aria-selected="true">2W</button>${card('Impressions', '<strong>98K</strong>')}`);
  assert.equal(scan(doc, 'soap628', route, now).analyticsSummary.period.days, 14);
  doc.querySelector('button').textContent = 'Today';
  const changedAt = new Date(now.getTime() + 3000);
  assert.equal(scan(doc, 'soap628', route, changedAt).analyticsSummary, undefined);
  const stillOld = scan(doc, 'soap628', route, new Date(changedAt.getTime() + 60000));
  assert.equal(stillOld.analyticsSummary, undefined);
  assert.equal(stillOld.analytics.length, 0, 'the unchanged 2W total must not become today’s exposure');
  doc.querySelector('strong').textContent = '250';
  const updatedAt = new Date(changedAt.getTime() + 61000);
  assert.equal(scan(doc, 'soap628', route, updatedAt).analyticsSummary, undefined);
  const settled = scan(doc, 'soap628', route, new Date(updatedAt.getTime() + 1600));
  assert.equal(settled.analyticsSummary.period.days, 1);
  assert.equal(settled.analytics[0].value, 250);
});

test('a completed loading cycle can confirm identical totals after a period change', () => {
  const doc = documentFor(`<button aria-selected="true">2W</button>${card('Impressions', '<strong>0</strong>')}`);
  scan(doc, 'soap628', route, now);
  doc.querySelector('button').textContent = '7D';
  doc.querySelector('main').setAttribute('aria-busy', 'true');
  assert.equal(scan(doc, 'soap628', route, new Date(now.getTime() + 2000)).analyticsSummary, undefined);
  doc.querySelector('main').removeAttribute('aria-busy');
  assert.equal(scan(doc, 'soap628', route, new Date(now.getTime() + 4000)).analyticsSummary, undefined);
  const settled = scan(doc, 'soap628', route, new Date(now.getTime() + 5600));
  assert.equal(settled.analyticsSummary.period.days, 7);
  assert.equal(settled.analyticsSummary.impressions.value, 0);
});
