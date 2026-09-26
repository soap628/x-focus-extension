import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState, reduce, ensureDay, validateBackup } from '../core.js';
import { assessAccount, actionExperience, accountAnalytics } from '../assessment.js';
import { hudSummary } from '../hud-state.js';

const now = new Date('2026-09-26T12:00:00Z');
const metric = (value, approximate = false) => ({ value, approximate, source: 'analytics', at: now.toISOString() });
const setup = () => reduce(newState(), { type: 'settings', username: 'soap628', posts: 2, replies: 10 }, now);
const overview = (values = {}, period = {}) => ({ at: now.toISOString(), source: 'analytics', period: { label: '2W', days: 14, start: '2026-09-13', end: '2026-09-26', ...period }, ...values });

test('experience comes exclusively from recorded posts at five and replies at one', () => {
  const state = setup(), day = state.days['2026-09-26'];
  day.posts = 4; day.replies = 6;
  day.followers = metric(1e12); day.verifiedFollowers = metric(1e12);
  state.analyticsSummary = overview({ impressions: metric(1e12), engagements: metric(1e12) });
  const result = assessAccount(state, now);
  assert.equal(result.version, 'action-v1'); assert.equal(result.score, 26); assert.equal(result.totalXp, 26);
  assert.deepEqual(result.actions, { posts: 4, replies: 6, postXp: 20, replyXp: 6 });
  assert.deepEqual(result.dimensions, [{ key: 'posts', count: 4, rate: 5, xp: 20 }, { key: 'replies', count: 6, rate: 1, xp: 6 }]);
  assert.equal(result.level, 1); assert.equal(result.progress, 26); assert.equal(result.toNext, 74);
});

test('each hundred EXP advances a level with no level fifty ceiling', () => {
  const state = setup(), day = state.days['2026-09-26'];
  for (const [posts, replies, xp, level, progress, toNext] of [[0, 0, 0, 1, 0, 100], [19, 4, 99, 1, 99, 1], [20, 0, 100, 2, 0, 100], [1000, 6, 5006, 51, 6, 94], [10000, 10000, 60000, 601, 0, 100]]) {
    Object.assign(day, { posts, replies });
    const result = assessAccount(state);
    assert.deepEqual([result.totalXp, result.level, result.progress, result.toNext], [xp, level, progress, toNext]);
    assert.equal(result.atMax, false); assert.equal(result.maxScore, null); assert.equal(result.expPerLevel, 100);
  }
});

test('Analytics two-week versus one-week windows cannot change action levels or experience', () => {
  const state = setup();
  Object.assign(state.days['2026-09-26'], { posts: 21, replies: 7 });
  state.analyticsSummary = overview({ impressions: metric(98000), engagements: metric(14000) });
  const initial = assessAccount(state, now);
  state.analyticsSummary = overview({ impressions: metric(700), engagements: metric(0) }, { label: '7D', days: 7, start: '2026-09-20' });
  assert.deepEqual(assessAccount(state, now), initial);
  state.analyticsSummary = null;
  state.days['2026-09-26'].followers = metric(0);
  state.days['2026-09-26'].verifiedFollowers = metric(0);
  state.account.blueVerified = { value: true, source: 'network', at: now.toISOString() };
  assert.deepEqual(assessAccount(state, new Date('2028-01-01T00:00:00Z')), initial);
});

test('recorded daily history keeps accumulating across midnight and pause or resume', () => {
  let state = setup();
  Object.assign(ensureDay(state, '2026-09-25'), { posts: 20, replies: 10 });
  Object.assign(state.days['2026-09-26'], { posts: 2, replies: 7 });
  const initial = assessAccount(state);
  assert.equal(initial.totalXp, 127);
  const nextDay = new Date('2026-09-26T16:00:00Z');
  const tomorrow = hudSummary(state, nextDay);
  assert.equal(tomorrow.posts, 0); assert.equal(tomorrow.replies, 0); assert.equal(tomorrow.totalXp, 127);
  state = reduce(state, { type: 'tracking', enabled: false }, now);
  state = reduce(state, { type: 'tracking', enabled: true }, nextDay);
  assert.equal(state.tracking.startedAt, nextDay.toISOString());
  assert.deepEqual(assessAccount(state), initial, 'resuming capture must not filter away saved experience');
});

test('targets and page-only snapshots never add actions; corrections change the recorded total', () => {
  let state = setup();
  state = reduce(state, { type: 'settings', username: 'soap628', posts: 100, replies: 100 }, now);
  state = reduce(state, { type: 'capture', username: 'soap628', posts: [{ id: '44', text: 'visible older post', createdAt: now.toISOString(), views: 999999 }] }, now);
  assert.equal(actionExperience(state), 0);
  state = reduce(state, { type: 'adjust', kind: 'posts', amount: 1 }, now);
  state = reduce(state, { type: 'adjust', kind: 'replies', amount: 1 }, now);
  assert.equal(actionExperience(state), 6);
  state = reduce(state, { type: 'adjust', kind: 'posts', amount: -1 }, now);
  assert.equal(actionExperience(state), 1);
});

test('old backups revalue saved action history at five and one without rewriting it', () => {
  const original = setup();
  Object.assign(original.days['2026-09-26'], { posts: 4, replies: 6, note: 'private note' });
  delete original.account; delete original.analyticsSummary; original.version = 1;
  const restored = reduce(newState(), { type: 'import', data: validateBackup(original) }, now);
  const before = JSON.stringify(restored), summary = hudSummary(restored, now);
  assert.equal(summary.totalXp, 26); assert.equal(summary.xp, 26); assert.equal(summary.level, 1);
  assert.equal(JSON.stringify(restored), before);
  assert.ok(!JSON.stringify(summary).includes('private note'));
  assert.equal(summary.verifiedFollowers, null); assert.equal(summary.blueVerified, null);
});

test('invalid action values do not create fractional or negative experience', () => {
  const state = setup();
  for (const value of [-1, 1.5, Infinity, NaN, '12']) {
    Object.assign(state.days['2026-09-26'], { posts: value, replies: value });
    assert.equal(actionExperience(state), 0);
  }
});

test('separate analytics retain period totals, daily averages, approximation and timestamps', () => {
  const state = setup();
  state.analyticsSummary = overview({ impressions: metric(98000, true), engagements: metric(3200, true) });
  const analytics = accountAnalytics(state, now);
  assert.equal(analytics.impressions.value, 7000); assert.equal(analytics.engagements.value, 3200 / 14);
  assert.equal(analytics.impressions.totalValue, 98000); assert.equal(analytics.impressions.sourceLabel, '2W · 14 天日均');
  assert.equal(analytics.impressions.period.days, 14); assert.equal(analytics.impressions.approximate, true);
  assert.equal(analytics.impressions.at, now.toISOString());
  assert.deepEqual(hudSummary(state, now).analytics, analytics);
  assert.equal(assessAccount(state).score, 0);
});

test('missing analytics stay unknown while explicit zero remains zero', () => {
  const state = setup(); assert.deepEqual(accountAnalytics(state, now), { impressions: null, engagements: null });
  state.analyticsSummary = overview({ impressions: metric(0), engagements: metric(0) });
  const analytics = accountAnalytics(state, now);
  assert.equal(analytics.impressions.value, 0); assert.equal(analytics.engagements.value, 0);
  assert.equal(assessAccount(state).level, 1);
});

test('only collected days in the recent 28-day window form fallback impression averages', () => {
  const state = setup();
  ensureDay(state, '2026-09-25').impressions = metric(300, true); state.days['2026-09-26'].impressions = metric(100);
  ensureDay(state, '2026-08-20').impressions = metric(1000000); ensureDay(state, '2026-09-27').impressions = metric(1000000);
  state.days['2026-09-26'].trackedViews = 1000000;
  const reading = accountAnalytics(state, now).impressions;
  assert.equal(reading.value, 200); assert.equal(reading.sourceLabel, '已采集 2 天日均'); assert.equal(reading.period.days, 2); assert.equal(reading.approximate, true);
});

test('post-view increments stay separate from account impressions and experience', () => {
  const state = setup(); state.days['2026-09-26'].trackedViews = 95000;
  const summary = hudSummary(state, now);
  assert.equal(summary.views.kind, 'tracked'); assert.equal(summary.analytics.impressions, null); assert.equal(summary.totalXp, 0);
});

test('short, stale, undated, future and historical reports do not enter current averages', () => {
  for (const report of [
    overview({ impressions: metric(98000) }, { days: 1 }), overview({ impressions: metric(98000) }, { days: null }),
    { ...overview({ impressions: metric(98000) }), at: '2026-08-01T12:00:00Z' },
    { ...overview({ impressions: metric(98000) }), at: '2026-09-27T12:00:00Z' },
    { ...overview({ impressions: metric(98000) }), at: null },
    overview({ impressions: metric(98000) }, { start: '2026-07-01', end: '2026-07-14' })
  ]) {
    const state = setup(); state.analyticsSummary = report;
    assert.deepEqual(accountAnalytics(state, now), { impressions: null, engagements: null });
  }
});

test('recent explicit ranges take precedence but their replacement never accumulates totals', () => {
  const state = setup(); state.days['2026-09-26'].impressions = metric(100000);
  state.analyticsSummary = overview({ impressions: metric(1400) });
  assert.equal(accountAnalytics(state, now).impressions.value, 100);
  state.analyticsSummary = overview({ impressions: metric(700) });
  assert.equal(accountAnalytics(state, now).impressions.value, 50);
  assert.equal(accountAnalytics(state, now).impressions.totalValue, 700);
});

test('summary preserves verification provenance and latest verified follower snapshot', () => {
  const state = setup(); ensureDay(state, '2026-09-24').verifiedFollowers = metric(2200, true);
  state.account = { blueVerified: { value: true, source: 'network', at: now.toISOString() } };
  const summary = hudSummary(state, now);
  assert.equal(summary.verifiedFollowers.value, 2200); assert.equal(summary.verifiedFollowers.date, '2026-09-24');
  assert.equal(summary.verifiedFollowers.approximate, true); assert.deepEqual(summary.blueVerified, state.account.blueVerified);
  state.account.blueVerified.value = false; assert.equal(hudSummary(state, now).blueVerified.value, false);
  assert.equal(summary.totalXp, 0);
});

test('analytics metrics must be recent themselves even when their envelope is current', () => {
  for (const at of ['2025-01-01T12:00:00Z', '2026-08-29T15:59:59Z', '2026-09-26T12:00:01Z']) {
    const state = setup(); state.analyticsSummary = overview({ impressions: { ...metric(140000), at }, engagements: { ...metric(14000), at } });
    assert.deepEqual(accountAnalytics(validateBackup(JSON.parse(JSON.stringify(state))), now), { impressions: null, engagements: null });
  }
});

test('metric timestamps later than their envelope are rejected independently', () => {
  const state = setup(), envelopeAt = '2026-09-26T11:00:00Z';
  state.analyticsSummary = { ...overview({ impressions: metric(140000), engagements: { ...metric(14000), at: envelopeAt } }), at: envelopeAt };
  const analytics = accountAnalytics(validateBackup(JSON.parse(JSON.stringify(state))), now);
  assert.equal(analytics.impressions, null); assert.equal(analytics.engagements.value, 1000); assert.equal(analytics.engagements.at, new Date(envelopeAt).toISOString());
});

test('stale summary readings fall back to valid daily impressions without reviving interactions', () => {
  const state = setup(); state.days['2026-09-26'].impressions = metric(800);
  state.analyticsSummary = overview({ impressions: { ...metric(140000), at: '2025-01-01T12:00:00Z' }, engagements: { ...metric(14000), at: '2025-01-01T12:00:00Z' } });
  const analytics = accountAnalytics(validateBackup(state), now);
  assert.equal(analytics.impressions.value, 800); assert.equal(analytics.impressions.sourceLabel, '已采集 1 天日均'); assert.equal(analytics.engagements, null);
});

test('daily fallback rejects stale, future, malformed or pre-record collection timestamps', () => {
  const state = setup();
  ensureDay(state, '2026-09-21').impressions = { ...metric(100000), at: '2025-01-01T12:00:00Z' };
  ensureDay(state, '2026-09-22').impressions = { ...metric(100000), at: '2026-09-26T12:00:01Z' };
  ensureDay(state, '2026-09-23').impressions = { ...metric(100000), at: 'invalid' };
  ensureDay(state, '2026-09-24').impressions = { ...metric(100000), at: '2026-09-23T12:00:00Z' };
  ensureDay(state, '2026-09-25').impressions = metric(300); state.days['2026-09-26'].impressions = metric(100);
  assert.equal(accountAnalytics(state, now).impressions.value, 200);
});

test('legacy timestamp-free readings work but explicit malformed timestamps do not', () => {
  const state = setup(); state.days['2026-09-26'].impressions = { value: 123, approximate: false };
  assert.equal(accountAnalytics(state, now).impressions.value, 123);
  state.analyticsSummary = overview({ impressions: { value: 1400, approximate: false }, engagements: { value: 140, approximate: false } });
  let analytics = accountAnalytics(state, now);
  assert.equal(analytics.impressions.value, 100); assert.equal(analytics.impressions.at, now.toISOString()); assert.equal(analytics.engagements.value, 10);
  state.analyticsSummary.impressions.at = ''; state.analyticsSummary.engagements.at = 'invalid';
  analytics = accountAnalytics(state, now); assert.equal(analytics.impressions.value, 123); assert.equal(analytics.engagements, null);
});

test('the oldest included Beijing collection day stays valid at the 28-day boundary', () => {
  const state = setup(); state.analyticsSummary = overview({ impressions: { ...metric(1400), at: '2026-08-29T16:00:00Z' } });
  assert.equal(accountAnalytics(state, now).impressions.value, 100);
});
