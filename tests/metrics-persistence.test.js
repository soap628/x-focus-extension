import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState, reduce, upgradeState, validateBackup, csv, dayKey, STORAGE_KEY } from '../core.js';
import { initializeRewards } from '../rewards.js';

const now = new Date('2026-09-26T10:00:00Z');
const later = new Date('2026-09-26T11:00:00Z');
const date = dayKey(now);
const setup = () => reduce(newState(), { type: 'settings', username: 'soap628', posts: 2, replies: 10 }, now);
const count = (value, approximate = false) => ({ value, approximate });
const period = { label: '2W', days: 14, start: '2026-09-13', end: '2026-09-26' };
const capture = values => ({ type: 'capture', username: 'soap628', ...values });
const example = () => reduce(setup(), capture({ verifiedFollowers: count(2200, true), blueVerified: true, analyticsSummary: { period, impressions: count(98000, true), engagements: count(3200, true), profileVisits: count(1100, true) } }), now);

test('new metrics are snapshots with missing values distinct from zero and false', () => {
  let state = setup();
  assert.equal(state.days[date].verifiedFollowers, null);
  assert.equal(state.account.blueVerified, null);
  assert.equal(state.analyticsSummary, null);
  state = reduce(state, capture({ verifiedFollowers: count(0), blueVerified: false, analyticsSummary: { period, impressions: count(0) } }), now);
  assert.equal(state.days[date].verifiedFollowers.value, 0);
  assert.equal(state.account.blueVerified.value, false);
  assert.equal(state.analyticsSummary.impressions.value, 0);
  assert.equal(state.analyticsSummary.engagements, null);
  assert.equal(state.days[date].impressions, null, 'two-week impressions are not daily impressions');
  const unchanged = reduce(state, capture({}), later);
  assert.deepEqual(unchanged.account, state.account);
  assert.deepEqual(unchanged.analyticsSummary, state.analyticsSummary);
});

test('confirmed false removes automatic VIP state, but missing status does not', () => {
  let state = example();
  state = reduce(state, capture({ followers: count(3050) }), later);
  assert.equal(state.account.blueVerified.value, true);
  state = reduce(state, { type: 'network', username: 'soap628', blueVerified: false }, later);
  assert.deepEqual(state.account.blueVerified, { value: false, source: 'network', at: later.toISOString() });
  state.account.blueVerified = { value: true, source: 'manual', at: now.toISOString() };
  assert.equal(reduce(state, capture({ blueVerified: false }), later).account.blueVerified.value, true);
});

test('account-only snapshots cannot follow a later change of bound account', () => {
  const bound = reduce(newState(), { type: 'bind', username: 'soap628' }, now);
  for (const values of [{ blueVerified: true }, { analyticsSummary: { period, impressions: count(98000) } }]) {
    const state = reduce(bound, capture(values), now);
    assert.equal(Object.keys(state.days).length, 0);
    assert.throws(() => reduce(state, { type: 'settings', username: 'another', posts: 2, replies: 10 }, now), /切换账号/);
  }
});

test('precise and manual readings retain priority for the same day and range', () => {
  let state = reduce(example(), capture({ verifiedFollowers: count(2214), analyticsSummary: { period, impressions: count(98045) } }), now);
  state = reduce(state, capture({ verifiedFollowers: count(2200, true), analyticsSummary: { period, impressions: count(99000, true), engagements: count(3211) } }), later);
  assert.equal(state.days[date].verifiedFollowers.value, 2214);
  assert.equal(state.analyticsSummary.impressions.value, 98045);
  assert.equal(state.analyticsSummary.engagements.value, 3211);
  assert.equal(state.analyticsSummary.profileVisits.value, 1100);
  state = reduce(state, { type: 'daily', date, verifiedFollowers: 2301, note: '' }, now);
  state.analyticsSummary.impressions.source = 'manual';
  state = reduce(state, capture({ verifiedFollowers: count(2310), analyticsSummary: { period, impressions: count(99050) } }), later);
  assert.equal(state.days[date].verifiedFollowers.value, 2301);
  assert.equal(state.analyticsSummary.impressions.value, 98045);
});

test('overlapping ranges replace the latest snapshot instead of accumulating', () => {
  let state = example();
  const sevenDays = { label: '7D', days: 7, start: '2026-09-20', end: '2026-09-26' };
  state = reduce(state, capture({ analyticsSummary: { period: sevenDays, impressions: count(34000, true) } }), later);
  assert.equal(state.analyticsSummary.impressions.value, 34000);
  assert.equal(state.analyticsSummary.profileVisits, null);
  assert.equal(state.days[date].impressions, null);
  assert.equal(state.analyticsSummary.period.days, 7);
});

test('rolling ranges without dates do not reuse a previous day precise value', () => {
  const rolling = { label: '2W', days: 14, start: null, end: null };
  let state = reduce(setup(), capture({ analyticsSummary: { period: rolling, impressions: count(98045) } }), now);
  state = reduce(state, capture({ analyticsSummary: { period: rolling, impressions: count(102000, true) } }), new Date('2026-09-27T10:00:00Z'));
  assert.equal(state.analyticsSummary.impressions.value, 102000);
});

test('new captures reject malformed numbers and inconsistent or unbounded periods', () => {
  for (const value of [-1, 1.5, Infinity, NaN, 1e13, '2200']) {
    assert.throws(() => reduce(setup(), capture({ verifiedFollowers: count(value) }), now));
    assert.throws(() => reduce(setup(), capture({ analyticsSummary: { period, impressions: count(value) } }), now));
  }
  for (const invalid of [{ ...period, days: 0 }, { ...period, days: 367 }, { ...period, days: 7 }, { ...period, end: null }, { ...period, start: '2026-02-30' }, { ...period, label: 'a'.repeat(81) }, { ...period, label: '\n2W' }, { ...period, start: '2026-09-14', end: '2026-09-27' }]) {
    assert.throws(() => reduce(setup(), capture({ analyticsSummary: { period: invalid, impressions: count(98000) } }), now));
  }
  assert.throws(() => reduce(setup(), capture({ analyticsSummary: { period } }), now));
  assert.throws(() => reduce(setup(), capture({ blueVerified: 'true' }), now));
  assert.throws(() => reduce(setup(), capture({ verifiedFollowers: { value: 50, approximate: 'false' } }), now));
});

test('backup roundtrip preserves old records and new snapshots including false and zero', () => {
  const state = reduce(example(), capture({ blueVerified: false, verifiedFollowers: count(0) }), later);
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(state))), state);
  const restored = reduce(newState(), { type: 'import', data: JSON.parse(JSON.stringify(state)) }, new Date('2026-09-27T10:00:00Z'));
  assert.deepEqual(restored, state);
  const exported = csv(state);
  assert.match(exported, /认证粉丝/);
  assert.match(exported, /"0","false","page"/);
});

test('v1 and old v2 migration preserves counts, deduplication and tracking start time', () => {
  const legacy = reduce(setup(), { type: 'network', username: 'soap628', posts: [{ id: '91001', kind: 'replies', createdAt: now.toISOString(), text: 'reply', views: 12 }] }, now);
  delete legacy.account; delete legacy.analyticsSummary; delete legacy.days[date].verifiedFollowers;
  for (const version of [1, 2]) {
    const source = { ...legacy, version };
    const upgraded = upgradeState(source, later);
    const restored = reduce(newState(), { type: 'import', data: source }, later);
    for (const state of [upgraded, restored]) {
      assert.equal(state.days[date].replies, 1);
      assert.deepEqual(state.days[date].loggedPostIds, ['91001']);
      assert.equal(state.tracking.startedAt, legacy.tracking.startedAt);
      assert.equal(state.days[date].trackedViews, 12);
      assert.equal(state.posts['91001'].viewMaximum, 12);
      assert.equal(state.account.blueVerified, null);
      assert.equal(state.analyticsSummary, null);
    }
  }
});

test('malicious new backup fields fail closed without prototype or timestamp coercion', () => {
  const mutations = [
    state => { state.account.blueVerified.value = 'true'; },
    state => { state.account.blueVerified.source = 'script'; },
    state => { state.account.blueVerified.at = 0; },
    state => { state.account = []; },
    state => { state.days[date].verifiedFollowers.value = -1; },
    state => { state.days[date].verifiedFollowers.at = 0; },
    state => { state.analyticsSummary.period.days = 999999; },
    state => { state.analyticsSummary.period.start = '__proto__'; },
    state => { state.analyticsSummary.period.label = 'a'.repeat(10000); },
    state => { state.analyticsSummary.period.end = '2026-09-27'; },
    state => { state.analyticsSummary.impressions.value = '98000'; },
    state => { state.analyticsSummary.profileVisits.approximate = 'yes'; },
    state => { state.analyticsSummary.at = 'not-a-date'; },
    state => { state.analyticsSummary.source = 'javascript'; },
    state => { state.analyticsSummary.impressions = null; state.analyticsSummary.engagements = null; state.analyticsSummary.profileVisits = null; },
  ];
  for (const mutate of mutations) {
    const state = example(); mutate(state);
    assert.throws(() => validateBackup(JSON.parse(JSON.stringify(state))));
  }
  const state = example();
  state.analyticsSummary = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => validateBackup(state));
  assert.equal({}.polluted, undefined);
});

test('service worker restart and extension reload retain stored counts and deduplication', async () => {
  const started = new Date(Date.now() - 1000);
  const observed = new Date();
  let saved = reduce(newState(), { type: 'settings', username: 'soap628', posts: 2, replies: 10 }, started);
  const post = { id: '91002', kind: 'posts', createdAt: observed.toISOString(), text: 'persistent post', views: 7 };
  saved = reduce(saved, { type: 'network', username: 'soap628', posts: [post], blueVerified: true, verifiedFollowers: count(2200) }, observed);
  saved = initializeRewards(saved, observed);
  const storage = { [STORAGE_KEY]: JSON.parse(JSON.stringify(saved)) };
  let listener, installed;
  globalThis.chrome = {
    runtime: { id: 'persistent-test', getURL: file => `chrome-extension://persistent-test/${file}`, onInstalled: { addListener(fn) { installed = fn; } }, onMessage: { addListener(fn) { listener = fn; } } },
    storage: { local: { async get() { return structuredClone(storage); }, async set(value) { Object.assign(storage, structuredClone(value)); } } },
  };
  const panel = { id: chrome.runtime.id, url: chrome.runtime.getURL('sidepanel.html'), tab: { id: 12 } };
  const xTab = { id: chrome.runtime.id, url: 'https://x.com/soap628', tab: { id: 13 } };
  const dispatch = (message, sender = panel) => new Promise(resolve => listener(message, sender, resolve));
  for (const restart of [1, 2]) {
    await import(`../background.js?persistence-test=${restart}`);
    if (restart === 2) installed();
    const before = await dispatch({ type: 'get' });
    assert.equal(before.ok, true);
    assert.deepEqual(before.state, saved);
    assert.equal((await dispatch({ type: 'network', username: 'soap628', posts: [post] }, xTab)).ok, true);
    const after = (await dispatch({ type: 'get' })).state;
    assert.equal(after.days[dayKey(observed)].posts, 1);
    assert.equal(after.days[dayKey(observed)].trackedViews, 7);
    assert.deepEqual(after.days[dayKey(observed)].loggedPostIds, ['91002']);
    assert.equal(after.tracking.startedAt, saved.tracking.startedAt);
    assert.equal(after.account.blueVerified.value, true);
    saved = after;
  }
});
