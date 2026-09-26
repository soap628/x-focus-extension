import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState, reduce, upgradeState, validateBackup } from '../core.js';
import { assessAccount } from '../assessment.js';
import { hudSummary } from '../hud-state.js';

const started = new Date('2026-09-26T02:00:00Z');
const published = new Date('2026-09-26T02:01:00Z');
const username = 'demo_creator';
const begin = () => reduce(newState(), { type: 'settings', username, posts: 100, replies: 500 }, started);
const post = (id, kind, createdAt = published) => ({ id, username, kind, createdAt: createdAt.toISOString(), text: 'Synthetic lifecycle fixture', views: 0, approximate: false });
const observe = (state, posts, at = published) => reduce(state, { type: 'network', username, posts }, at);
function assertExperience(state, at, totalXp, level, xp) {
  const summary = hudSummary(state, at), assessment = assessAccount(state, at);
  assert.equal(assessment.version, 'action-v1');
  assert.equal(assessment.totalXp, totalXp);
  assert.equal(assessment.score, totalXp);
  assert.equal(summary.totalXp, totalXp);
  assert.equal(summary.level, level);
  assert.equal(summary.xp, xp);
  assert.equal(summary.assessment.level, level);
  return summary;
}

test('first installation excludes old actions and awards exactly 6 EXP for a new own post and reply', () => {
  let state = begin();
  const old = new Date(started.getTime() - 1000);
  state = observe(state, [post('101', 'posts', old), post('102', 'replies', old)]);
  let summary = assertExperience(state, published, 0, 1, 0);
  assert.equal(summary.posts, 0); assert.equal(summary.replies, 0);
  assert.deepEqual(summary.goals, { posts: 100, replies: 500 }, 'large daily targets do not award EXP');

  state = observe(state, [post('103', 'posts'), post('104', 'replies')]);
  summary = assertExperience(state, published, 6, 1, 6);
  assert.equal(summary.posts, 1); assert.equal(summary.replies, 1);
  assert.deepEqual(summary.auto, { posts: 1, replies: 1 });

  const nextPostAt = new Date('2026-09-26T02:02:00Z');
  state = observe(state, [post('105', 'posts', nextPostAt)], nextPostAt);
  assertExperience(state, nextPostAt, 11, 1, 11);
  const nextReplyAt = new Date('2026-09-26T02:03:00Z');
  state = observe(state, [post('106', 'replies', nextReplyAt)], nextReplyAt);
  assertExperience(state, nextReplyAt, 12, 1, 12);
});

test('replays, persisted-state upgrades, a new day, analytics range changes and stale metrics leave earned EXP intact', () => {
  const actions = [post('201', 'posts'), post('202', 'replies')];
  let state = observe(begin(), actions);
  state = observe(state, actions);
  state = observe(state, actions.map(action => ({ ...action, views: 250 })));
  assertExperience(state, published, 6, 1, 6);

  const reloadedAt = new Date('2026-09-26T03:00:00Z');
  state = upgradeState(validateBackup(JSON.parse(JSON.stringify(state))), reloadedAt);
  assert.equal(state.tracking.startedAt, started.toISOString());
  state = observe(state, actions, reloadedAt);
  assertExperience(state, reloadedAt, 6, 1, 6);

  const nextDay = new Date('2026-09-27T02:00:00Z');
  state = observe(state, actions, nextDay);
  const nextDaySummary = assertExperience(state, nextDay, 6, 1, 6);
  assert.equal(nextDaySummary.posts, 0); assert.equal(nextDaySummary.replies, 0);
  assert.equal(state.days['2026-09-26'].loggedPostIds.length, 2);

  for (const [label, days, impressions, engagements] of [['7D', 7, 35000, 700], ['2W', 14, 1400000, 14000], ['7D', 7, 0, 0]]) {
    state = reduce(state, { type: 'capture', username, followers: { value: 100000 }, verifiedFollowers: { value: 25000 }, blueVerified: true,
      analyticsSummary: { period: { label, days, start: null, end: null }, impressions: { value: impressions }, engagements: { value: engagements } }
    }, nextDay);
    const summary = assertExperience(state, nextDay, 6, 1, 6);
    assert.equal(summary.analytics.impressions.period.label, label);
    assert.equal(summary.analytics.impressions.totalValue, impressions, 'the report genuinely changed while earned EXP stayed fixed');
  }

  const expiredAt = new Date('2026-11-01T02:00:00Z');
  const expired = assertExperience(state, expiredAt, 6, 1, 6);
  assert.equal(expired.analytics.impressions, null);
  assert.equal(expired.analytics.engagements, null);
  state = observe(state, [post('203', 'posts', expiredAt)], expiredAt);
  assertExperience(state, expiredAt, 11, 1, 11);
  state = observe(state, [post('204', 'replies', expiredAt)], expiredAt);
  assertExperience(state, expiredAt, 12, 1, 12);
});

test('the 100 EXP boundary advances the integrated HUD once and starts the next level at zero', () => {
  const actions = [
    ...Array.from({ length: 19 }, (_, index) => post(String(300 + index), 'posts')),
    ...Array.from({ length: 4 }, (_, index) => post(String(400 + index), 'replies'))
  ];
  let state = observe(begin(), actions);
  let summary = assertExperience(state, published, 99, 1, 99);
  assert.equal(summary.assessment.toNext, 1);
  const finalReply = post('404', 'replies');
  state = observe(state, [finalReply]);
  summary = assertExperience(state, published, 100, 2, 0);
  assert.equal(summary.assessment.toNext, 100);
  state = observe(state, [...actions, finalReply]);
  assertExperience(state, published, 100, 2, 0);
  state = observe(state, [post('500', 'posts')]);
  assertExperience(state, published, 105, 2, 5);
});
