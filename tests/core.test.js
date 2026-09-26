import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { newState, reduce, dayKey, ensureDay, progress, followerDelta, recentDates, streak, csv, validateBackup } from '../core.js';
const now = new Date('2026-09-26T10:00:00Z');
const setUp = () => reduce(newState(), { type: 'settings', username: '@Soap628', posts: 2, replies: 10 }, now);
const daily = (date, values = {}) => ({ type: 'daily', date, posts: null, replies: null, followers: null, impressions: null, note: '', ...values });
test('Beijing midnight creates a new day without changing yesterday', () => {
  const before = new Date('2026-09-26T15:59:59Z'), after = new Date('2026-09-26T16:00:00Z');
  let state = reduce(setUp(), { type: 'adjust', kind: 'posts', amount: 1 }, before);
  state = reduce(state, { type: 'adjust', kind: 'posts', amount: 1 }, after);
  assert.equal(dayKey(before), '2026-09-26'); assert.equal(dayKey(after), '2026-09-27');
  assert.equal(state.days['2026-09-26'].posts, 1); assert.equal(state.days['2026-09-27'].posts, 1);
});
test('goal changes apply today and future, preserve historical goals', () => {
  const state = setUp(); ensureDay(state, '2026-09-25');
  const changed = reduce(state, { type: 'settings', username: 'soap628', posts: 3, replies: 15 }, now);
  assert.equal(changed.days['2026-09-25'].goals.posts, 2); assert.equal(changed.days['2026-09-26'].goals.posts, 3);
  assert.equal(state.days['2026-09-26'].goals.posts, 2); assert.equal(ensureDay(changed, '2026-09-27').goals.replies, 15);
});
test('disabled goals never inflate completion streaks', () => {
  assert.deepEqual(progress({ posts: 0, replies: 0, goals: { posts: 0, replies: 0 } }), { percent: 0, complete: false, enabled: false });
  assert.equal(progress({ posts: 0, replies: 5, goals: { posts: 0, replies: 5 } }).complete, true);
  const state = setUp(); for (const date of ['2026-09-24', '2026-09-25']) { const d = ensureDay(state, date); d.posts = 2; d.replies = 10; }
  assert.equal(streak(state, '2026-09-26'), 2);
  ensureDay(state, '2026-09-23'); assert.equal(streak(state, '2026-09-26'), 2);
});
test('sparse follower changes disclose reference date and approximation', () => {
  let state = reduce(setUp(), daily('2026-09-22', { followers: 100 }), now);
  state = reduce(state, { type: 'capture', username: 'soap628', followers: { value: 120, approximate: true } }, now);
  assert.deepEqual(followerDelta(state, '2026-09-26'), { value: 20, previousDate: '2026-09-22', approximate: true });
  assert.equal(followerDelta(state, '2026-09-25'), null);
});
test('automatic snapshots cannot overwrite manual or precise data with rounded values', () => {
  let state = reduce(setUp(), { type: 'capture', username: 'soap628', followers: { value: 1234, approximate: false } }, now);
  state = reduce(state, { type: 'capture', username: 'soap628', followers: { value: 1200, approximate: true } }, now);
  assert.equal(state.days['2026-09-26'].followers.value, 1234);
  state = reduce(state, daily('2026-09-26', { followers: 1235 }), now);
  state = reduce(state, { type: 'capture', username: 'soap628', followers: { value: 1236, approximate: false } }, now);
  assert.equal(state.days['2026-09-26'].followers.value, 1235);
});
test('post snapshots deduplicate IDs and remain separate from daily impressions and actions', () => {
  const capture = { type: 'capture', username: 'soap628', posts: [{ id: '1234', views: 500, text: 'hello', approximate: false, createdAt: now.toISOString() }] };
  let state = reduce(setUp(), capture, now); state = reduce(state, capture, now);
  assert.equal(Object.keys(state.posts).length, 1); assert.equal(state.days['2026-09-26'].posts, 0);
  assert.equal(state.days['2026-09-26'].impressions, null);
  assert.throws(() => reduce(state, { ...capture, username: 'someone_else' }, now), /账号/);
});
test('account changes cannot mix historical data', () => {
  assert.equal(setUp().settings.username, 'soap628');
  assert.throws(() => reduce(setUp(), { type: 'settings', username: 'another', posts: 2, replies: 10 }, now), /切换账号/);
});
test('invalid dates and negative values rejected; blank and zero remain distinct', () => {
  assert.throws(() => reduce(setUp(), daily('2026-02-30'), now), /日期/);
  assert.throws(() => reduce(setUp(), daily('2026-09-27'), now), /日期/);
  assert.throws(() => reduce(setUp(), daily('2026-09-26', { followers: -1 }), now), /非负/);
  let state = reduce(setUp(), daily('2026-09-26', { followers: 0 }), now);
  state = reduce(state, daily('2026-09-26'), now);
  assert.equal(state.days['2026-09-26'].followers.value, 0); assert.equal(state.days['2026-09-26'].impressions, null);
  assert.equal(reduce(state, { type: 'adjust', kind: 'posts', amount: -1 }, now).days['2026-09-26'].posts, 0);
});
test('backup roundtrip preserves real records and rejects malformed imports', () => {
  const state = reduce(setUp(), daily('2026-09-26', { posts: 1, replies: 4, followers: 88, impressions: 345, note: '明天继续' }), now);
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(state))), state);
  const bad = structuredClone(state); bad.days = JSON.parse('{"__proto__":{}}');
  assert.throws(() => validateBackup(bad));
  assert.throws(() => validateBackup({ ...state, settings: { ...state.settings, username: '<script>' } }));
});
test('CSV safely quotes line breaks and neutralizes spreadsheet formulas', () => {
  const state = reduce(setUp(), daily('2026-09-26', { note: '=HYPERLINK("test")\nnew line' }), now);
  const exported = csv(state); assert.ok(exported.startsWith('\uFEFF')); assert.ok(exported.includes('"\'=HYPERLINK(""test"")\nnew line"'));
});
test('month and leap-day ranges are calendar-correct', () => {
  assert.deepEqual(recentDates('2024-03-01', 3), ['2024-02-28', '2024-02-29', '2024-03-01']);
});
const context = vm.createContext({ URL });
vm.runInContext(fs.readFileSync(new URL('../scanner.js', import.meta.url), 'utf8'), context);
const scanner = context.XFocusScanner;
test('page count parsing distinguishes exact, abbreviated, unavailable and localized values', () => {
  for (const [input, expected, approximate] of [['1,234 Followers', 1234, false], ['1.2K Views', 1200, true], ['2.3万 次浏览', 23000, true], ['0 回复', 0, false], ['250 粉丝', 250, false]]) {
    const value = scanner.parseCount(input); assert.equal(value?.value, expected, input); assert.equal(value?.approximate, approximate, input);
  }
  for (const input of ['', 'Views', '2026-09-26', '1,2K', '1.234 followers', 'Join 12 people']) assert.equal(scanner.parseCount(input), null, input);
});
