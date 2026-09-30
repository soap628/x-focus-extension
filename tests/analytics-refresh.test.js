import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { newState, reduce, METRIC_PRECISION_WINDOW_MS, validateBackup } from '../core.js';
import { hudSummary } from '../hud-state.js';

const start = new Date('2026-10-01T02:00:00Z');
const at = ms => new Date(start.getTime() + ms);
const period = { label: '7D', days: 7, start: '2026-09-25', end: '2026-10-01' };
const count = (value, approximate = false) => ({ value, approximate });
const setup = () => reduce(newState(), { type: 'settings', username: 'soap628', posts: 2, replies: 10 }, start);
const capture = values => ({ type: 'capture', username: 'soap628', ...values });
const packet = (approximate = false) => ({ followers: count(approximate ? 3400 : 3201, approximate), verifiedFollowers: count(approximate ? 2400 : 2201, approximate), analytics: [{ date: '2026-10-01', value: approximate ? 1700 : 1201, approximate }], analyticsSummary: { period, impressions: count(approximate ? 93400 : 90001, approximate), engagements: count(approximate ? 4100 : 3201, approximate), profileVisits: count(approximate ? 1400 : 1101, approximate) } });
const readings = state => [state.days['2026-10-01'].followers, state.days['2026-10-01'].verifiedFollowers, state.days['2026-10-01'].impressions, state.analyticsSummary.impressions, state.analyticsSummary.engagements, state.analyticsSummary.profileVisits];

test('adjacent DOM/network samples prefer exact values for a fixed 30-second window', () => {
  assert.equal(METRIC_PRECISION_WINDOW_MS, 30000);
  const exact = reduce(setup(), capture(packet()), start);
  for (const delay of [0, 1, 10000, 29999, 30000]) {
    const next = reduce(exact, capture(packet(true)), at(delay));
    assert.deepEqual(readings(next), readings(exact));
  }
  const roundedFirst = reduce(setup(), capture(packet(true)), start);
  const preciseNext = reduce(roundedFirst, { ...capture(packet()), type: 'network' }, at(1));
  assert.deepEqual(readings(preciseNext).map(metric => [metric.value, metric.approximate]), readings(exact).map(metric => [metric.value, metric.approximate]));
});

test('after the precision window newer rounded readings replace old exact values and reach HUD data', () => {
  const initial = reduce(setup(), capture(packet()), start);
  const next = reduce(initial, capture(packet(true)), at(30001));
  assert.deepEqual(readings(next).map(metric => metric.value), [3400, 2400, 1700, 93400, 4100, 1400]);
  assert.ok(readings(next).every(metric => metric.approximate && metric.at === at(30001).toISOString()));
  const summary = hudSummary(next, at(30001));
  assert.equal(summary.verifiedFollowers.value, 2400);
  assert.equal(summary.analytics.impressions.totalValue, 93400);
  assert.equal(summary.analytics.engagements.totalValue, 4100);
  assert.equal(summary.totalXp, 0);
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(next))), next);
});

test('repeated approximate observations do not extend an exact observation precision window', () => {
  let state = reduce(setup(), capture(packet()), start);
  for (const delay of [10000, 20000, 30000]) state = reduce(state, capture(packet(true)), at(delay));
  assert.equal(state.analyticsSummary.impressions.at, start.toISOString());
  state = reduce(state, capture(packet(true)), at(30001));
  assert.equal(state.analyticsSummary.impressions.value, 93400);
});

test('older observed readings and envelopes cannot roll back values, timestamps or the selected period', () => {
  let state = reduce(setup(), capture(packet()), start);
  state = reduce(state, capture(packet(true)), at(60000));
  const stored = structuredClone(state);
  for (const delay of [0, 30000, 59999]) {
    state = reduce(state, capture(packet()), at(delay));
    assert.deepEqual(readings(state), readings(stored));
    assert.deepEqual(state.analyticsSummary, stored.analyticsSummary);
  }
  state = reduce(state, capture({ analyticsSummary: { period: { label: '2W', days: 14, start: '2026-09-18', end: '2026-10-01' }, impressions: count(1), engagements: count(0) } }), at(1000));
  assert.deepEqual(state.analyticsSummary, stored.analyticsSummary);
  assert.equal(hudSummary(state, at(60000)).analytics.engagements.totalValue, 4100);
});

test('manual metrics remain protected after the window and null fields never erase observations', () => {
  let state = reduce(setup(), capture(packet()), start);
  state = reduce(state, { type: 'daily', date: '2026-10-01', followers: 3333, verifiedFollowers: 2222, impressions: 1111, note: '' }, start);
  for (const key of ['impressions', 'engagements', 'profileVisits']) state.analyticsSummary[key].source = 'manual';
  const manual = readings(state);
  state = reduce(state, capture(packet(true)), at(3600000));
  assert.deepEqual(readings(state), manual);
  state = reduce(state, capture({ followers: null, verifiedFollowers: null, analyticsSummary: null }), at(3600001));
  assert.deepEqual(readings(state), manual);
  state = reduce(state, capture({ analyticsSummary: { period, impressions: null, engagements: null, profileVisits: count(0) } }), at(3600002));
  assert.deepEqual(readings(state), manual);
});

test('new calendar days and changed Analytics ranges never reuse the wrong-period readings', () => {
  let state = reduce(setup(), capture(packet()), start);
  const tomorrow = new Date('2026-10-02T02:00:00Z');
  const nextPeriod = { label: '7D', days: 7, start: '2026-09-26', end: '2026-10-02' };
  state = reduce(state, capture({ verifiedFollowers: count(2400, true), analyticsSummary: { period: nextPeriod, impressions: count(95000, true) } }), tomorrow);
  assert.equal(state.days['2026-10-01'].verifiedFollowers.value, 2201);
  assert.equal(state.days['2026-10-02'].verifiedFollowers.value, 2400);
  assert.equal(state.analyticsSummary.impressions.value, 95000);
  assert.equal(state.analyticsSummary.engagements, null);
  assert.equal(state.analyticsSummary.profileVisits, null);
  assert.equal(hudSummary(state, tomorrow).analytics.engagements, null);
  state = reduce(state, capture({ analyticsSummary: { period: nextPeriod, engagements: count(5000, true) } }), new Date(tomorrow.getTime() + 1));
  assert.equal(state.analyticsSummary.impressions.value, 95000);
  assert.equal(state.analyticsSummary.engagements.value, 5000);
});

test('same-range missing and null metrics retain the available snapshot until a real replacement arrives', () => {
  let state = reduce(setup(), capture(packet()), start);
  const old = structuredClone(state.analyticsSummary);
  state = reduce(state, capture({ analyticsSummary: { period, impressions: count(93400, true), engagements: null } }), at(60000));
  assert.deepEqual(state.analyticsSummary.engagements, old.engagements);
  assert.deepEqual(state.analyticsSummary.profileVisits, old.profileVisits);
  assert.equal(state.analyticsSummary.impressions.value, 93400);
});

test('a valid Today range remains visible through storage, HUD summary and actual HUD rendering', () => {
  let state = reduce(setup(), capture({ verifiedFollowers: count(2400, true), analyticsSummary: { period: { label: 'Today', days: 1, start: '2026-10-01', end: '2026-10-01' }, impressions: count(93400, true), engagements: count(4100, true) } }), start);
  state.hudPreferences.mode = 'full';
  const summary = hudSummary(state, start);
  assert.equal(summary.analytics.impressions.totalValue, 93400);
  assert.equal(summary.analytics.impressions.value, 93400);
  assert.equal(summary.analytics.engagements.value, 4100);
  assert.equal(summary.totalXp, 0);
  const { document, window } = parseHTML('<html><body><main>X</main></body></html>'); window.innerWidth = 1920; window.innerHeight = 1080;
  const context = vm.createContext({ document, window, MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: callback => callback(), setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {} });
  vm.runInContext(['i18n.js', 'relic-icons.js', 'hud-theme.js', 'hud.js'].map(file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8')).join('\n'), context);
  const hud = context.XFocusHUD.mount({ getBounds: () => ({ left: 410, right: 1510 }) });
  hud.update(summary);
  const root = document.querySelector('#x-focus-hud').shadowRoot;
  assert.match(root.querySelector('.views .metric-value').textContent, /93\.4k/);
  assert.match(root.querySelector('.engagements .metric-value').textContent, /4,100/);
  assert.match(root.querySelector('.verified-followers .metric-value').textContent, /2,400/);
  hud.destroy();
});

test('display accepts explicit one-to-six-day ranges but rejects inconsistent dates', () => {
  for (let days = 1; days <= 6; days++) {
    const startDate = new Date(Date.UTC(2026, 9, 2 - days)).toISOString().slice(0, 10);
    const state = reduce(setup(), capture({ analyticsSummary: { period: { label: days + 'D', days, start: startDate, end: '2026-10-01' }, impressions: count(days * 100), engagements: count(days * 10) } }), start);
    const summary = hudSummary(state, start);
    assert.equal(summary.analytics.impressions.value, 100); assert.equal(summary.analytics.engagements.value, 10);
    state.analyticsSummary.period.days++;
    assert.equal(hudSummary(state, start).analytics.engagements, null);
  }
});
