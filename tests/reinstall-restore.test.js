import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState, reduce, ensureDay, recentDates, validateBackup } from '../core.js';
import { assessAccount } from '../assessment.js';
import { initializeRewards, settleRewards, openChest, rewardsSummary } from '../rewards.js';

const installedAt = new Date('2026-09-24T02:00:00Z');
const firstAt = new Date('2026-09-24T02:01:00Z');
const secondAt = new Date('2026-09-25T02:01:00Z');
const reinstalledAt = new Date('2026-09-26T02:00:00Z');
const username = 'restore_owner';
const dispatch = (state, action, now) => settleRewards(state, reduce(state, action, now), action, now);
const post = (id, kind, at, views = null) => ({ id, kind, createdAt: at.toISOString(), views, text: 'Saved local activity', approximate: false });
const packet = (posts, account = username) => ({ type: 'network', username: account, posts });
const rawBackup = state => JSON.stringify(state, null, 2);
const restore = (state, raw, now = reinstalledAt) => dispatch(state, { type: 'import', data: JSON.parse(raw) }, now);

function recordedHistory(account = username) {
  let state = initializeRewards(reduce(newState(), { type: 'settings', username: account, posts: 2, replies: 3 }, installedAt), installedAt);
  const first = [
    ...Array.from({ length: 80 }, (_, index) => post(String(10000 + index), 'posts', firstAt)),
    ...Array.from({ length: 3 }, (_, index) => post(String(20000 + index), 'replies', firstAt))
  ];
  const second = [
    post('30000', 'posts', secondAt, 23), post('30001', 'posts', secondAt, 15),
    ...Array.from({ length: 4 }, (_, index) => post(String(40000 + index), 'replies', secondAt))
  ];
  state = dispatch(state, packet(first, account), firstAt);
  state = openChest(state, 'daily:2026-09-24', firstAt, () => 0);
  state = openChest(state, 'level:5', firstAt, () => 0.5);
  state = dispatch(state, packet(second, account), secondAt);
  state = dispatch(state, {
    type: 'capture', username: account, followers: { value: 321 }, verifiedFollowers: { value: 123 }, blueVerified: true,
    analyticsSummary: { period: { label: '7D', days: 7, start: '2026-09-19', end: '2026-09-25' }, impressions: { value: 7100 }, engagements: { value: 350 } }
  }, secondAt);
  state = dispatch(state, { type: 'daily', date: '2026-09-25', note: 'A saved reflection / 已保存复盘' }, secondAt);
  state = dispatch(state, { type: 'language', language: 'en' }, secondAt);
  state = dispatch(state, { type: 'hud-preferences', preferences: { mode: 'full', position: { anchor: 'left', x: 0, y: 0.6 } } }, secondAt);
  return { state, first, second };
}

const actions = state => Object.fromEntries(Object.entries(state.days).map(([date, day]) => [date, {
  posts: day.posts, replies: day.replies, auto: day.auto, loggedPostIds: day.loggedPostIds
}]));

test('raw JSON restores a real recorded history into a fresh installation with EXP, deduplication and opened loot intact', () => {
  const { state } = recordedHistory();
  const exported = rawBackup(state);
  const fresh = newState();
  const restored = restore(fresh, exported);

  assert.deepEqual(restored, state);
  assert.deepEqual(fresh, newState(), 'restoring does not mutate the previously loaded state');
  assert.deepEqual(assessAccount(restored), assessAccount(state));
  assert.equal(assessAccount(restored).totalXp, 417);
  assert.equal(assessAccount(restored).level, 5);
  assert.equal(restored.tracking.startedAt, installedAt.toISOString(), 'reinstallation time must not replace the original tracking boundary');
  assert.equal(restored.days['2026-09-24'].loggedPostIds.length, 83);
  assert.equal(restored.days['2026-09-25'].loggedPostIds.length, 6);
  assert.deepEqual(restored.rewards, state.rewards);
  assert.equal(rewardsSummary(restored).totalOwned, 2);
  assert.equal(rewardsSummary(restored).pending, 1);
  assert.equal(restored.settings.language, 'en');
  assert.deepEqual(restored.hudPreferences, { mode: 'full', position: { anchor: 'left', x: 0, y: 0.6 } });
  assert.equal(restored.days['2026-09-25'].note, 'A saved reflection / 已保存复盘');
  assert.equal(restored.account.blueVerified.value, true);
  assert.equal(restored.analyticsSummary.impressions.value, 7100);
});

test('replayed posts after reinstall never reaward EXP or chests, while a new post and reply earn 5 and 1 EXP', () => {
  const { state, first, second } = recordedHistory();
  let restored = restore(newState(), rawBackup(state));
  const expectedActions = actions(restored);
  const expectedRewards = structuredClone(restored.rewards);
  for (let i = 0; i < 3; i++) restored = dispatch(restored, packet([...first, ...second]), reinstalledAt);
  for (const [date, day] of Object.entries(expectedActions)) assert.deepEqual(actions(restored)[date], day);
  assert.equal(assessAccount(restored).totalXp, 417);
  assert.deepEqual(restored.rewards, expectedRewards);

  for (const opened of expectedRewards.earned.filter(event => event.openedAt)) {
    const repeated = openChest(restored, opened.id, reinstalledAt, () => { throw new Error('A restored chest must not roll again'); });
    assert.deepEqual(repeated.rewards, expectedRewards);
  }
  restored = dispatch(restored, packet([post('50000', 'posts', reinstalledAt)]), reinstalledAt);
  assert.equal(assessAccount(restored).totalXp, 422);
  restored = dispatch(restored, packet([post('50001', 'replies', reinstalledAt)]), reinstalledAt);
  assert.equal(assessAccount(restored).totalXp, 423);
  assert.equal(restored.days['2026-09-26'].posts, 1);
  assert.equal(restored.days['2026-09-26'].replies, 1);
  assert.deepEqual(restored.rewards, expectedRewards);

  const persistedAgain = restore(newState(), rawBackup(restored), new Date('2026-09-27T02:00:00Z'));
  assert.equal(assessAccount(persistedAgain).totalXp, 423);
  assert.deepEqual(persistedAgain.rewards, expectedRewards);
});

test('the durable daily ID ledger still deduplicates after post preview snapshots have been evicted', () => {
  const { state, first, second } = recordedHistory();
  state.posts = {};
  let restored = restore(newState(), rawBackup(state));
  restored = dispatch(restored, packet([...first, ...second]), reinstalledAt);
  assert.equal(assessAccount(restored).totalXp, 417);
  assert.equal(restored.days['2026-09-24'].posts, 80);
  assert.equal(restored.days['2026-09-25'].replies, 4);
  assert.deepEqual(restored.rewards, state.rewards);
  assert.equal(Object.keys(restored.posts).length, 89, 'the snapshot cache can refill independently of credited actions');
});

test('restored tracking boundary admits a missed original-installation action but still excludes pre-install history', () => {
  const { state } = recordedHistory();
  let restored = restore(newState(), rawBackup(state));
  const missedAt = new Date('2026-09-25T03:00:00Z');
  const observed = [
    post('60000', 'posts', new Date(installedAt.getTime() - 1000)),
    post('60001', 'posts', missedAt), post('60002', 'replies', missedAt)
  ];
  restored = dispatch(restored, packet(observed), reinstalledAt);
  assert.equal(assessAccount(restored).totalXp, 423);
  assert.equal(restored.days['2026-09-25'].posts, 3);
  assert.equal(restored.days['2026-09-25'].replies, 5);
  assert.equal(Object.values(restored.days).some(day => day.loggedPostIds.includes('60000')), false);
  assert.deepEqual(restored.rewards, state.rewards, 'late old-day captures cannot issue a new daily chest');
  restored = dispatch(restored, packet(observed), reinstalledAt);
  assert.equal(assessAccount(restored).totalXp, 423);
});

test('an explicitly confirmed whole-backup replacement never mixes another account history or rewards', () => {
  const { state: backup } = recordedHistory();
  let current = initializeRewards(reduce(newState(), { type: 'settings', username: 'other_owner', posts: 1, replies: 0 }, reinstalledAt), reinstalledAt);
  current = dispatch(current, packet([post('90000', 'posts', reinstalledAt)], 'other_owner'), reinstalledAt);
  current = openChest(current, 'daily:2026-09-26', reinstalledAt, () => 0.95);
  const before = structuredClone(current);

  const restored = restore(current, rawBackup(backup));
  assert.equal(restored.settings.username, username);
  assert.deepEqual(restored, backup, 'replacement means the file account and history, never a sum of both accounts');
  assert.equal(restored.posts['90000'], undefined);
  assert.equal(restored.days['2026-09-26'], undefined);
  assert.equal(restored.rewards.earned.some(event => event.id === 'daily:2026-09-26'), false);
  assert.deepEqual(current, before);
  assert.throws(() => dispatch(restored, packet([post('90001', 'posts', reinstalledAt)], 'other_owner'), reinstalledAt), /账号/);
});

test('corrupt or structurally invalid restore files reject before changing the saved history or loot', () => {
  const { state } = recordedHistory();
  const before = structuredClone(state);
  assert.throws(() => restore(state, '{"version":2,'));
  const corruptions = [
    backup => { backup.version = 99; },
    backup => { backup.settings.username = '<script>'; },
    backup => { backup.days['2026-09-24'].loggedPostIds.push('not-a-post-id'); },
    backup => { backup.days['2026-09-24'].posts = -1; },
    backup => { backup.tracking.startedAt = 'broken'; },
    backup => { backup.rewards.earned[0].itemId = 'unknown-treasure'; },
    backup => { backup.hudPreferences.position.y = 2; }
  ];
  for (const corrupt of corruptions) {
    const bad = structuredClone(state); corrupt(bad);
    assert.throws(() => restore(state, rawBackup(bad)));
    assert.deepEqual(state, before);
  }
  assert.equal(assessAccount(restore(state, rawBackup(before))).totalXp, 417, 'a rejected restore cannot poison the following valid one');
});

test('valid long-term raw JSON can exceed the former 5 MB UI limit without exceeding schema limits', () => {
  const state = reduce(newState(), { type: 'settings', username, posts: 2, replies: 3 }, reinstalledAt);
  for (const date of recentDates('2026-09-26', 1800)) ensureDay(state, date).note = '记'.repeat(1000);
  const raw = rawBackup(state);
  const bytes = Buffer.byteLength(raw, 'utf8');
  assert.ok(bytes > 5 * 1024 * 1024);
  assert.ok(bytes < 10 * 1024 * 1024);
  const restored = validateBackup(JSON.parse(raw));
  assert.equal(Object.keys(restored.days).length, 1800);
  assert.equal(restored.days['2026-09-26'].note.length, 1000);
});
