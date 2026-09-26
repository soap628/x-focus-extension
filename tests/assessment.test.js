import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState, reduce, ensureDay, validateBackup } from '../core.js';
import { assessAccount } from '../assessment.js';
import { hudSummary } from '../hud-state.js';

const now = new Date('2026-09-26T12:00:00Z');
const metric = (value, approximate = false) => ({ value, approximate, source: 'analytics', at: now.toISOString() });
const setup = () => reduce(newState(), { type: 'settings', username: 'soap628', posts: 2, replies: 10 }, now);
const byKey = assessment => Object.fromEntries(assessment.dimensions.map(d => [d.key, d]));
const overview = (values = {}, period = {}) => ({ at: now.toISOString(), source: 'analytics', period: { label: '2W', days: 14, start: '2026-09-13', end: '2026-09-26', ...period }, ...values });

test('all five dimensions have equal caps and the published benchmarks reach 1000 points', () => {
  const state = setup(), day = state.days['2026-09-26'];
  day.posts = 1000;
  day.followers = metric(100000); day.verifiedFollowers = metric(25000);
  state.analyticsSummary = overview({ impressions: metric(1400000), engagements: metric(140000) });
  const result = assessAccount(state, now);
  assert.deepEqual(result.dimensions.map(d => [d.score, d.max]), Array(5).fill([200, 200]));
  assert.deepEqual(result.dimensions.map(d => d.benchmark), [20000, 100000, 25000, 100000, 10000]);
  assert.equal(result.score, 1000); assert.equal(result.coverage, 5); assert.equal(result.provisional, false);
  assert.equal(result.level, 50); assert.equal(result.progress, 100); assert.equal(result.toNext, 0); assert.equal(result.atMax, true);
});

test('a single enormous metric cannot contribute beyond its 20 percent share', () => {
  const state = setup();
  state.days['2026-09-26'].followers = metric(1e12);
  const result = assessAccount(state, now), dimensions = byKey(result);
  assert.equal(dimensions.followers.score, 200);
  assert.equal(dimensions.action.score, 0);
  assert.equal(result.score, 200); assert.equal(result.coverage, 2);
  assert.equal(result.provisional, true);
});

test('an explicit two-week analytics total becomes a daily average with its context retained', () => {
  const state = setup();
  state.analyticsSummary = overview({ impressions: metric(98000, true), engagements: metric(3200, true) });
  const dimensions = byKey(assessAccount(state, now));
  assert.equal(dimensions.impressions.value, 7000);
  assert.equal(dimensions.engagements.value, 3200 / 14);
  assert.equal(dimensions.impressions.totalValue, 98000);
  assert.equal(dimensions.impressions.sourceLabel, '2W · 14 天日均');
  assert.equal(dimensions.impressions.period.days, 14);
  assert.equal(dimensions.impressions.approximate, true);
  assert.equal(dimensions.impressions.at, now.toISOString());
  assert.equal(dimensions.impressions.score, Math.round(200 * Math.log1p(7000) / Math.log1p(100000)));
});

test('equivalent daily rates score equally across seven-day and two-week ranges', () => {
  const state = setup();
  state.analyticsSummary = overview({ impressions: metric(98000), engagements: metric(14000) });
  const fortnight = assessAccount(state, now);
  state.analyticsSummary = overview({ impressions: metric(49000), engagements: metric(7000) }, { label: '7D', days: 7, start: '2026-09-20' });
  const week = assessAccount(state, now);
  assert.equal(fortnight.score, week.score);
  assert.deepEqual(fortnight.dimensions.map(d => d.value), week.dimensions.map(d => d.value));
});

test('missing metrics stay unknown while measured zero counts toward coverage', () => {
  const state = setup();
  const empty = assessAccount(state, now), missing = byKey(empty);
  assert.equal(empty.coverage, 1); assert.equal(empty.score, 0);
  assert.equal(missing.followers.score, null); assert.equal(missing.followers.value, null);
  state.days['2026-09-26'].followers = metric(0);
  state.days['2026-09-26'].verifiedFollowers = metric(0);
  state.analyticsSummary = overview({ impressions: metric(0), engagements: metric(0) });
  const zeros = assessAccount(state, now);
  assert.equal(zeros.coverage, 5); assert.equal(zeros.provisional, false); assert.equal(zeros.score, 0);
  assert.ok(zeros.dimensions.every(d => d.value === 0 && d.score === 0));
});

test('only collected days in the recent 28-day window form the fallback impression average', () => {
  const state = setup();
  ensureDay(state, '2026-09-25').impressions = metric(300, true);
  state.days['2026-09-26'].impressions = metric(100);
  ensureDay(state, '2026-08-20').impressions = metric(1000000);
  ensureDay(state, '2026-09-27').impressions = metric(1000000);
  state.days['2026-09-26'].trackedViews = 1000000;
  const dimension = byKey(assessAccount(state, now)).impressions;
  assert.equal(dimension.value, 200); assert.equal(dimension.sourceLabel, '已采集 2 天日均');
  assert.equal(dimension.period.days, 2); assert.equal(dimension.approximate, true);
});

test('post-view increments never substitute for account impressions', () => {
  const state = setup(); state.days['2026-09-26'].trackedViews = 95000;
  const summary = hudSummary(state, now);
  assert.equal(summary.views.kind, 'tracked');
  assert.equal(byKey(summary.assessment).impressions.score, null);
});

test('short, stale, undated, future, and historical analytics reports do not enter current daily averages', () => {
  for (const report of [
    overview({ impressions: metric(98000) }, { days: 1 }),
    overview({ impressions: metric(98000) }, { days: null }),
    { ...overview({ impressions: metric(98000) }), at: '2026-08-01T12:00:00Z' },
    { ...overview({ impressions: metric(98000) }), at: '2026-09-27T12:00:00Z' },
    { ...overview({ impressions: metric(98000) }), at: null },
    overview({ impressions: metric(98000) }, { start: '2026-07-01', end: '2026-07-14' })
  ]) {
    const state = setup(); state.analyticsSummary = report;
    const result = byKey(assessAccount(state, now));
    assert.equal(result.impressions.value, null);
    assert.equal(result.engagements.value, null);
  }
});

test('a recent explicit period takes precedence over isolated daily observations', () => {
  const state = setup();
  state.days['2026-09-26'].impressions = metric(100000);
  state.analyticsSummary = overview({ impressions: metric(1400) });
  assert.equal(byKey(assessAccount(state, now)).impressions.value, 100);
});

test('refreshing or replacing a rolling snapshot recalculates rather than accumulating score', () => {
  const state = setup();
  state.analyticsSummary = overview({ impressions: metric(140000), engagements: metric(14000) });
  const initial = assessAccount(state, now);
  assert.deepEqual(assessAccount(structuredClone(state), now), initial);
  state.analyticsSummary = overview({ impressions: metric(70000), engagements: metric(7000) });
  const next = assessAccount(state, now);
  assert.equal(byKey(next).impressions.value, 5000);
  assert.ok(next.score < initial.score);
});

test('old backups reproduce action experience without needing new metrics or rewriting stored history', () => {
  const original = setup();
  Object.assign(original.days['2026-09-26'], { posts: 4, replies: 6, note: 'private note' });
  delete original.account; delete original.analyticsSummary;
  original.version = 1;
  const restored = reduce(newState(), { type: 'import', data: validateBackup(original) }, now);
  const before = JSON.stringify(restored);
  const summary = hudSummary(restored, now);
  assert.equal(summary.totalXp, 110); assert.equal(summary.xp, 10);
  assert.equal(byKey(summary.assessment).action.value, 110);
  assert.equal(summary.level, summary.assessment.level);
  assert.equal(summary.assessment.coverage, 1);
  assert.equal(summary.verifiedFollowers, null); assert.equal(summary.blueVerified, null);
  assert.equal(JSON.stringify(restored), before);
  assert.ok(!JSON.stringify(summary).includes('private note'));
});

test('level 50 is reached at 980 points, with no fictitious progress toward level 51', () => {
  const state = setup(), day = state.days['2026-09-26'];
  day.posts = 1000; day.followers = metric(100000); day.verifiedFollowers = metric(25000);
  state.analyticsSummary = overview({ impressions: metric(1400000), engagements: metric(3981 * 14) });
  const result = assessAccount(state, now);
  assert.equal(result.score, 980); assert.equal(result.level, 50);
  assert.equal(result.progress, 100); assert.equal(result.toNext, 0); assert.equal(result.atMax, true);
});

test('summary preserves verified status provenance and latest verified follower snapshot', () => {
  const state = setup();
  ensureDay(state, '2026-09-24').verifiedFollowers = metric(2200, true);
  state.account = { blueVerified: { value: true, source: 'network', at: now.toISOString() } };
  const summary = hudSummary(state, now);
  assert.equal(summary.verifiedFollowers.value, 2200); assert.equal(summary.verifiedFollowers.date, '2026-09-24');
  assert.equal(summary.verifiedFollowers.approximate, true);
  assert.deepEqual(summary.blueVerified, state.account.blueVerified);
  state.account.blueVerified.value = false;
  assert.equal(hudSummary(state, now).blueVerified.value, false);
});

test('restored analytics metrics must be recent themselves even when the snapshot envelope is current', () => {
  for (const at of ['2025-01-01T12:00:00Z', '2026-08-29T15:59:59Z', '2026-09-26T12:00:01Z']) {
    const state = setup();
    state.analyticsSummary = overview({ impressions: { ...metric(140000), at }, engagements: { ...metric(14000), at } });
    const restored = validateBackup(JSON.parse(JSON.stringify(state)));
    const dimensions = byKey(assessAccount(restored, now));
    assert.equal(dimensions.impressions.value, null, `impressions at ${at}`);
    assert.equal(dimensions.engagements.value, null, `engagements at ${at}`);
  }
});

test('metric timestamps later than their analytics envelope are rejected independently', () => {
  const state = setup();
  const envelopeAt = '2026-09-26T11:00:00Z';
  state.analyticsSummary = { ...overview({
    impressions: metric(140000),
    engagements: { ...metric(14000), at: envelopeAt }
  }), at: envelopeAt };
  const restored = validateBackup(JSON.parse(JSON.stringify(state)));
  const dimensions = byKey(assessAccount(restored, now));
  assert.equal(dimensions.impressions.value, null);
  assert.equal(dimensions.engagements.value, 1000);
  assert.equal(dimensions.engagements.at, new Date(envelopeAt).toISOString());
});

test('stale summary metrics fall back to valid daily impressions without reviving stale interactions', () => {
  const state = setup();
  state.days['2026-09-26'].impressions = metric(800);
  state.analyticsSummary = overview({
    impressions: { ...metric(140000), at: '2025-01-01T12:00:00Z' },
    engagements: { ...metric(14000), at: '2025-01-01T12:00:00Z' }
  });
  const dimensions = byKey(assessAccount(validateBackup(state), now));
  assert.equal(dimensions.impressions.value, 800);
  assert.equal(dimensions.impressions.sourceLabel, '已采集 1 天日均');
  assert.equal(dimensions.engagements.score, null);
});

test('daily fallback rejects explicit stale, future, invalid, or pre-record collection timestamps', () => {
  const state = setup();
  ensureDay(state, '2026-09-21').impressions = { ...metric(100000), at: '2025-01-01T12:00:00Z' };
  ensureDay(state, '2026-09-22').impressions = { ...metric(100000), at: '2026-09-26T12:00:01Z' };
  ensureDay(state, '2026-09-23').impressions = { ...metric(100000), at: 'invalid' };
  ensureDay(state, '2026-09-24').impressions = { ...metric(100000), at: '2026-09-23T12:00:00Z' };
  ensureDay(state, '2026-09-25').impressions = metric(300);
  state.days['2026-09-26'].impressions = metric(100);
  const dimension = byKey(assessAccount(state, now)).impressions;
  assert.equal(dimension.value, 200);
  assert.equal(dimension.sourceLabel, '已采集 2 天日均');
});

test('timestamp-free legacy readings retain compatibility but explicit malformed timestamps do not', () => {
  const state = setup();
  state.days['2026-09-26'].impressions = { value: 123, approximate: false };
  assert.equal(byKey(assessAccount(state, now)).impressions.value, 123);
  state.analyticsSummary = overview({ impressions: { value: 1400, approximate: false }, engagements: { value: 140, approximate: false } });
  let dimensions = byKey(assessAccount(state, now));
  assert.equal(dimensions.impressions.value, 100);
  assert.equal(dimensions.impressions.at, now.toISOString());
  assert.equal(dimensions.engagements.value, 10);
  state.analyticsSummary.impressions.at = '';
  state.analyticsSummary.engagements.at = 'invalid';
  dimensions = byKey(assessAccount(state, now));
  assert.equal(dimensions.impressions.value, 123);
  assert.equal(dimensions.engagements.value, null);
});

test('the oldest included Beijing collection day remains valid at the 28-day boundary', () => {
  const state = setup();
  const boundary = '2026-08-29T16:00:00Z'; // Beijing 2026-08-30, the oldest of 28 calendar days.
  state.analyticsSummary = overview({ impressions: { ...metric(1400), at: boundary } });
  assert.equal(byKey(assessAccount(state, now)).impressions.value, 100);
});
