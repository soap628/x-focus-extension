import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { newState, reduce, validateBackup } from '../core.js';
import { hudSummary } from '../hud-state.js';

// Synthetic markup exercises the parser -> persisted record -> HUD boundary.
// These are not captured account statistics or a claim about live X markup.
const source = fs.readFileSync(new URL('../scanner.js', import.meta.url), 'utf8');
const now = new Date('2026-10-01T04:00:00Z');
const route = '/i/account_analytics';
function page() {
  const card = (label, value, key, tail = '12%') => `<div role="button">
    <div><div><div><span>${label}</span></div></div></div>
    <div><div><span class="${key}">${value}</span><span><svg></svg><span>${tail}</span></span></div></div>
  </div>`;
  const { document } = parseHTML(`<html><body>
    <nav><a data-testid="AppTabBar_Profile_Link" href="/soap628">Profile</a></nav>
    <main><button aria-pressed="true">7D</button>
      <div role="progressbar" aria-label="Verified followers target" aria-valuenow="2400" aria-valuemax="3500"></div>
      ${card('Checkmark followers', '2.4K', 'fans', '/ 3.5K')}
      ${card('Impressions', '93.4K', 'impressions')}
      ${card('Engagements', '4.1K', 'engagements')}
    </main></body></html>`);
  const context = vm.createContext({ URL, Date, Intl });
  vm.runInContext(source, context);
  return { document, scan: at => context.XFocusScanner.scan(document, 'soap628', route, at) };
}
function stateWithAction() {
  let state = reduce(newState(), { type: 'settings', username: 'soap628', posts: 2, replies: 10 }, now);
  state = reduce(state, { type: 'adjust', kind: 'posts', amount: 1 }, now);
  return reduce(state, { type: 'adjust', kind: 'replies', amount: 1 }, now);
}
function capture(state, fixture, at) { return reduce(state, { type: 'capture', ...fixture.scan(at) }, at); }

test('nested English cards and a determinate goal bar reach the HUD without changing action EXP', () => {
  const fixture = page();
  const state = capture(stateWithAction(), fixture, now);
  const hud = hudSummary(state, now);
  assert.equal(hud.verifiedFollowers?.value, 2400);
  assert.equal(hud.analytics.impressions?.totalValue, 93400);
  assert.equal(hud.analytics.engagements?.totalValue, 4100);
  assert.equal(hud.analytics.impressions.period.days, 7);
  assert.equal(hud.totalXp, 6);
  assert.equal(hud.posts, 1);
  assert.equal(hud.replies, 1);
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(state))), state);
});

test('new rounded card readings replace an earlier precise snapshot through the complete pipeline', () => {
  const fixture = page();
  const precise = value => ({ value, approximate: false });
  let state = reduce(stateWithAction(), { type: 'capture', username: 'soap628',
    verifiedFollowers: precise(2201), analyticsSummary: {
      period: { label: '7D', days: 7, start: null, end: null },
      impressions: precise(90001), engagements: precise(3201)
    } }, now);
  const later = new Date(now.getTime() + 60_000);
  state = capture(state, fixture, later);
  const hud = hudSummary(state, later);
  assert.equal(hud.verifiedFollowers.value, 2400);
  assert.equal(hud.analytics.impressions.totalValue, 93400);
  assert.equal(hud.analytics.engagements.totalValue, 4100);
  assert.equal(hud.analytics.impressions.approximate, true);
  assert.equal(hud.analytics.engagements.at, later.toISOString());
  assert.equal(hud.totalXp, 6);
});

test('a late period selection recovers, but unchanged cards cannot be relabeled as a different period', () => {
  const fixture = page();
  const button = fixture.document.querySelector('button');
  button.removeAttribute('aria-pressed');
  let state = capture(stateWithAction(), fixture, now);
  assert.equal(hudSummary(state, now).analytics.impressions, null);
  button.setAttribute('aria-pressed', 'true');
  const selectedAt = new Date(now.getTime() + 2000);
  state = capture(state, fixture, selectedAt);
  const settledAt = new Date(now.getTime() + 4000);
  state = capture(state, fixture, settledAt);
  assert.equal(hudSummary(state, settledAt).analytics.engagements.totalValue, 4100);
  button.textContent = '2W';
  state = capture(state, fixture, new Date(now.getTime() + 6000));
  state = capture(state, fixture, new Date(now.getTime() + 60_000));
  assert.equal(state.analyticsSummary.period.days, 7, 'retain the last confirmed range while the new range loads');
  assert.equal(state.analyticsSummary.impressions.value, 93400);
});

test('partially refreshed cards never carry the previous period engagement total into the HUD', () => {
  const fixture = page();
  let state = capture(stateWithAction(), fixture, now);
  fixture.document.querySelector('button').textContent = '2W';
  fixture.document.querySelector('.impressions').textContent = '150K';
  state = capture(state, fixture, new Date(now.getTime() + 2000));
  const partialAt = new Date(now.getTime() + 4000);
  state = capture(state, fixture, partialAt);
  const partial = hudSummary(state, partialAt);
  assert.equal(partial.analytics.impressions.period.days, 14);
  assert.equal(partial.analytics.impressions.totalValue, 150000);
  assert.equal(partial.analytics.engagements, null, 'the unchanged 7D interaction total stays unknown for 2W');
  fixture.document.querySelector('.engagements').textContent = '8.2K';
  state = capture(state, fixture, new Date(now.getTime() + 6000));
  const completeAt = new Date(now.getTime() + 8000);
  state = capture(state, fixture, completeAt);
  const complete = hudSummary(state, completeAt);
  assert.equal(complete.analytics.engagements.period.days, 14);
  assert.equal(complete.analytics.engagements.totalValue, 8200);
  assert.equal(complete.totalXp, 6);
});
