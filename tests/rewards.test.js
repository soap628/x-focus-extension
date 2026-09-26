import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState, reduce, validateBackup, validateRewards, dayKey, recentDates, STORAGE_KEY } from '../core.js';
import { initializeRewards, settleRewards, openChest, rewardsSummary, REWARD_ITEMS } from '../rewards.js';
import { assessAccount } from '../assessment.js';
import { hudAction, hudSummary } from '../hud-state.js';

const now = new Date('2026-09-26T10:00:00Z');
const later = new Date('2026-09-26T11:00:00Z');
const date = dayKey(now);
const setup = (posts = 1, replies = 1) => initializeRewards(reduce(newState(), { type: 'settings', username: 'soap628', posts, replies }, now), now);
const dispatch = (state, action, at = now) => settleRewards(state, reduce(state, action, at), action, at);
const post = (id, kind = 'posts', createdAt = now.toISOString()) => ({ id, kind, createdAt, views: null, text: 'test' });
const network = (...posts) => ({ type: 'network', username: 'soap628', posts });
const chestState = (count = 1) => {
  const state = setup();
  const dates = recentDates(date, count);
  state.rewards.initializedAt = `${dates[0]}T00:00:00.000Z`;
  state.rewards.earned = dates.map(date => ({ id: `daily:${date}`, reason: 'daily', date, openedAt: null, itemId: null }));
  return state;
};

test('language is validated, persisted separately from goals, and migrates old backups', () => {
  let state = setup();
  assert.equal(state.settings.language, 'zh-CN');
  state = dispatch(state, hudAction({ command: 'language', language: 'en' }, state));
  state = dispatch(state, { type: 'settings', username: 'soap628', posts: 3, replies: 15 });
  assert.equal(state.settings.language, 'en');
  assert.equal(hudSummary(state, now).language, 'en');
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(state))), state);
  assert.throws(() => reduce(state, { type: 'language', language: 'javascript' }, now));
  assert.throws(() => hudAction({ command: 'language', language: null }, state));
  const old = JSON.parse(JSON.stringify(state)); delete old.settings.language; delete old.rewards;
  const restored = validateBackup(old);
  assert.equal(restored.settings.language, 'zh-CN'); assert.equal(restored.rewards, null);
  old.settings.language = null;
  assert.throws(() => validateBackup(old));
});

test('initialization baselines recorded action experience without historic chests', () => {
  let old = reduce(newState(), { type: 'settings', username: 'soap628', posts: 1, replies: 1 }, now);
  old = reduce(old, { type: 'capture', username: 'soap628', followers: { value: 100000 }, verifiedFollowers: { value: 25000 } }, now);
  old.days[date].posts = 999;
  const initialized = initializeRewards(old, now);
  assert.ok(initialized.rewards.levelHighWater > 20);
  assert.equal(initialized.rewards.levelHighWater, assessAccount(old, now).level);
  assert.deepEqual(initialized.rewards.earned, []);
  assert.equal(initializeRewards(initialized, later), initialized);
  assert.deepEqual(dispatch(initialized, { type: 'heartbeat', username: 'soap628' }, later).rewards, initialized.rewards);
});

test('level thresholds award once and corrected counts cannot farm recovered levels', () => {
  let state = dispatch(setup(), { type: 'daily', date, posts: 200, note: '' });
  assert.deepEqual(state.rewards.earned.map(event => event.id), ['level:5', 'level:10']);
  const highWater = state.rewards.levelHighWater;
  state = dispatch(state, { type: 'daily', date, posts: 0, note: '' });
  assert.equal(state.rewards.levelHighWater, highWater);
  state = dispatch(state, { type: 'daily', date, posts: 200, note: '' });
  assert.equal(state.rewards.earned.length, 2);
  assert.equal(rewardsSummary(state).nextLevel, 15);
});

test('legacy unearned performance watermark 37 migrates to action level one and can earn level five', () => {
  const legacy = setup();
  delete legacy.rewards.levelSystem; legacy.rewards.levelHighWater = 37;
  const migrated = initializeRewards(legacy, now);
  assert.equal(migrated.rewards.levelSystem, 'action-v1');
  assert.equal(migrated.rewards.levelHighWater, 1);
  assert.deepEqual(migrated.rewards.earned, []);
  assert.equal(rewardsSummary(migrated).nextLevel, 5);
  const grown = dispatch(migrated, { type: 'daily', date, posts: 80, note: '' });
  assert.deepEqual(grown.rewards.earned.map(event => event.id), ['level:5']);
  assert.equal(initializeRewards(grown, later), grown);
});

test('legacy earned and opened milestones survive migration and the same node is never reissued', () => {
  const legacy = setup(); delete legacy.rewards.levelSystem; legacy.rewards.levelHighWater = 37;
  legacy.rewards.earned = [{ id: 'level:35', reason: 'level', date, level: 35, openedAt: now.toISOString(), itemId: 'quill' }];
  let state = initializeRewards(legacy, now);
  assert.equal(state.rewards.levelHighWater, 35);
  assert.deepEqual(state.rewards.earned, legacy.rewards.earned);
  assert.equal(rewardsSummary(state).nextLevel, 40);
  state = dispatch(state, { type: 'daily', date, posts: 700, note: '' });
  assert.equal(state.rewards.earned.length, 1);
  state = dispatch(state, { type: 'daily', date, posts: 780, note: '' });
  assert.deepEqual(state.rewards.earned.map(event => event.id), ['level:35', 'level:40']);
  assert.equal(state.rewards.earned[0].itemId, 'quill');
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(state))), state);
});

test('importing a v0.6 backup cannot restore a stale performance-based high watermark', () => {
  const legacy = setup(); delete legacy.rewards.levelSystem; legacy.rewards.levelHighWater = 37;
  let state = dispatch(setup(), { type: 'import', data: legacy });
  assert.equal(state.rewards.levelSystem, 'action-v1'); assert.equal(state.rewards.levelHighWater, 1);
  assert.equal(state.rewards.earned.length, 0);
  legacy.days[date].posts = 200;
  state = dispatch(state, { type: 'import', data: legacy }, later);
  assert.equal(state.rewards.levelHighWater, 11); assert.equal(state.rewards.earned.length, 0);
});

test('action milestones beyond level fifty remain valid through backup and chest opening', () => {
  let state = dispatch(setup(), { type: 'daily', date, posts: 1980, note: '' });
  assert.equal(assessAccount(state).level, 100);
  assert.equal(state.rewards.levelHighWater, 100);
  assert.ok(state.rewards.earned.some(event => event.id === 'level:100'));
  assert.equal(rewardsSummary(state).nextLevel, 105);
  state = openChest(state, 'level:100', now, () => 0);
  assert.equal(state.rewards.earned.find(event => event.id === 'level:100').itemId, 'quill');
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(state))), state);
  assert.deepEqual(hudAction({ command: 'open-chest', id: 'level:100' }, state), { type: 'open-chest', id: 'level:100' });
});

test('daily chest requires fresh automatic completion and duplicate packets do not regrant', () => {
  let state = dispatch(setup(), network(post('1001')));
  assert.equal(state.rewards.earned.filter(event => event.reason === 'daily').length, 0);
  const second = network(post('1002', 'replies'));
  state = dispatch(state, second);
  assert.equal(state.rewards.earned.filter(event => event.reason === 'daily').length, 1);
  state = dispatch(state, second, later);
  state = dispatch(state, { type: 'heartbeat', username: 'soap628' }, later);
  assert.equal(state.rewards.earned.filter(event => event.reason === 'daily').length, 1);
  assert.equal(state.rewards.earned.find(event => event.reason === 'daily').id, `daily:${date}`);
});

test('manual completion, lower targets, imports and old-day packets never grant daily chests', () => {
  let state = dispatch(setup(), { type: 'daily', date, posts: 1, replies: 1, note: '' });
  assert.equal(state.rewards.earned.filter(event => event.reason === 'daily').length, 0);
  state = dispatch(setup(0, 3), network(post('1011', 'replies')));
  state = dispatch(state, { type: 'settings', username: 'soap628', posts: 0, replies: 1 });
  state = dispatch(state, network(post('1012', 'replies')));
  assert.equal(state.rewards.earned.filter(event => event.reason === 'daily').length, 0);
  let completed = dispatch(setup(), network(post('1013'), post('1014', 'replies')));
  completed.rewards = null;
  state = dispatch(setup(), { type: 'import', data: completed });
  assert.equal(state.rewards.earned.filter(event => event.reason === 'daily').length, 0);
  state = setup(); state.tracking.startedAt = '2026-09-25T00:00:00.000Z';
  state = dispatch(state, network(post('1015', 'posts', '2026-09-25T10:00:00.000Z'), post('1016', 'replies', '2026-09-25T10:00:00.000Z')));
  assert.equal(state.rewards.earned.filter(event => event.reason === 'daily').length, 0);
});

test('disabled goals and pre-existing completed days do not grant retroactive daily chests', () => {
  let state = dispatch(setup(0, 0), network(post('1020')));
  assert.equal(state.rewards.earned.filter(event => event.reason === 'daily').length, 0);
  state = setup(); state.days[date].auto = { posts: 1, replies: 1 }; state.days[date].posts = 1; state.days[date].replies = 1;
  state = dispatch(state, network(post('1021')));
  assert.equal(state.rewards.earned.filter(event => event.reason === 'daily').length, 0);
});

test('opening persists a single result and completes all twelve unique items first', () => {
  let state = chestState(13), rolls = 0;
  const firstId = state.rewards.earned[0].id;
  for (let i = 0; i < 12; i++) state = openChest(state, undefined, now, () => { rolls++; return 0; });
  assert.equal(rolls, 12);
  assert.equal(new Set(state.rewards.earned.slice(0, 12).map(event => event.itemId)).size, 12);
  const before = JSON.parse(JSON.stringify(state));
  state = openChest(state, firstId, later, () => { throw new Error('already opened'); });
  assert.deepEqual(state, before);
  state = openChest(state, undefined, later, () => 0);
  const summary = rewardsSummary(state);
  assert.equal(summary.totalOwned, 12); assert.equal(summary.totalItems, 12); assert.equal(summary.pending, 0);
  assert.equal(summary.items.find(item => item.id === 'quill').count, 2);
  assert.equal(summary.lastDrop.id, 'quill');
  assert.equal(summary.lastDrop.openedAt, later.toISOString());
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(state))), state);
  assert.throws(() => openChest(state, undefined, later));
  for (const value of [-1, 1, NaN, Infinity, '0.2']) assert.throws(() => openChest(chestState(), undefined, now, () => value));
  assert.equal(REWARD_ITEMS.every(item => item.name.en && item.name['zh-CN'] && item.description.en && item.description['zh-CN']), true);
});

test('same-account backup restore keeps opened drops and the highest milestone watermark', () => {
  let current = chestState();
  current.rewards.levelHighWater = 30;
  const old = JSON.parse(JSON.stringify(current));
  current = openChest(current, undefined, now, () => 0.4);
  old.rewards.levelHighWater = 1;
  let restored = dispatch(current, { type: 'import', data: old }, later);
  assert.equal(restored.rewards.levelHighWater, 30);
  assert.equal(restored.rewards.earned[0].itemId, current.rewards.earned[0].itemId);
  assert.equal(rewardsSummary(restored).pending, 0);
  restored = dispatch(current, { type: 'import', data: { ...old, rewards: null } }, later);
  assert.equal(restored.rewards.earned[0].itemId, current.rewards.earned[0].itemId);
  restored = dispatch(old, { type: 'import', data: current }, later);
  assert.equal(restored.rewards.earned[0].itemId, current.rewards.earned[0].itemId, 'a newer backup may contain the persisted opening of a local pending chest');
});

test('reward validation rejects missing times, numeric zero, forged IDs and inconsistent loot', () => {
  const mutations = [
    rewards => { delete rewards.initializedAt; }, rewards => { rewards.initializedAt = 0; },
    rewards => { rewards.initializedAt = '2026-02-30T00:00:00.000Z'; }, rewards => { rewards.levelHighWater = 0; },
    rewards => { rewards.levelHighWater = Number.MAX_SAFE_INTEGER + 1; }, rewards => { rewards.version = 2; }, rewards => { rewards.levelSystem = 'forged'; },
    rewards => { delete rewards.earned[0].openedAt; }, rewards => { rewards.earned[0].openedAt = 0; },
    rewards => { delete rewards.earned[0].itemId; }, rewards => { rewards.earned[0].itemId = 'quill'; },
    rewards => { rewards.earned[0].openedAt = now.toISOString(); },
    rewards => { rewards.earned[0].id = '__proto__'; }, rewards => { rewards.earned.push({ ...rewards.earned[0] }); },
    rewards => { rewards.earned[0].level = 5; }, rewards => { rewards.earned[0].date = '2026-09-25'; },
    rewards => { rewards.earned[0] = { id: 'level:7', reason: 'level', date, level: 7, openedAt: null, itemId: null }; },
    rewards => { rewards.earned[0] = { id: 'level:5', reason: 'level', date, level: 5, openedAt: null, itemId: null }; },
    rewards => { rewards.earned = Array(5011).fill(rewards.earned[0]); }
  ];
  for (const mutate of mutations) {
    const rewards = chestState().rewards; mutate(rewards);
    assert.throws(() => validateRewards(rewards));
  }
  assert.deepEqual(validateRewards(chestState().rewards), chestState().rewards);
  assert.throws(() => openChest(chestState(), undefined, new Date('2026-09-25T10:00:00.000Z')));
});

test('background serializes two tabs opening the same chest and persists language on restart', async () => {
  const current = new Date();
  const state = setup();
  state.rewards.initializedAt = new Date(current.getTime() - 1000).toISOString();
  const today = dayKey(current);
  const id = `daily:${today}`;
  state.rewards.earned = [{ id, reason: 'daily', date: today, openedAt: null, itemId: null }];
  const storage = { [STORAGE_KEY]: state };
  let listener;
  globalThis.chrome = {
    runtime: { id: 'reward-test', getURL: file => `chrome-extension://reward-test/${file}`, onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
    storage: { local: { async get() { return structuredClone(storage); }, async set(value) { await new Promise(resolve => setTimeout(resolve, 1)); Object.assign(storage, structuredClone(value)); } } }
  };
  const xTab = { id: chrome.runtime.id, url: 'https://x.com/home', tab: { id: 1 } };
  const send = message => new Promise(resolve => listener(message, xTab, resolve));
  await import('../background.js?rewards-concurrent=1');
  const answers = await Promise.all([send({ type: 'hud-command', command: 'open-chest', id }), send({ type: 'hud-command', command: 'open-chest', id })]);
  assert.ok(answers.every(answer => answer.ok));
  assert.equal(answers[0].hud.rewards.lastDrop.id, answers[1].hud.rewards.lastDrop.id);
  assert.equal(storage[STORAGE_KEY].rewards.earned.length, 1);
  assert.equal((await send({ type: 'hud-command', command: 'language', language: 'en' })).hud.language, 'en');
  await import('../background.js?rewards-concurrent=2');
  const restarted = await send({ type: 'hud' });
  assert.equal(restarted.hud.language, 'en'); assert.equal(restarted.hud.rewards.pending, 0);
  assert.equal(restarted.hud.rewards.lastDrop.id, answers[0].hud.rewards.lastDrop.id);
  assert.equal((await send({ type: 'language', language: 'en' })).ok, false, 'raw content action remains blocked');
  assert.equal((await send({ type: 'hud-command', command: 'language', language: 'fr' })).ok, false);
});

test('passive actions and analytics expiry neither award milestones nor move the watermark', () => {
  let state = reduce(newState(), { type: 'settings', username: 'soap628', posts: 2, replies: 10 }, now);
  state.days[date].posts = 79;
  state.analyticsSummary = {
    period: { label: '2W', days: 14, start: null, end: null },
    impressions: { value: 140, approximate: false, source: 'analytics', at: '2026-08-30T10:00:00Z' },
    at: '2026-08-30T10:00:00Z', source: 'analytics'
  };
  state.days[date].impressions = { value: 100000, approximate: false, source: 'analytics', at: now.toISOString() };
  state = initializeRewards(state, now);
  const nextDay = new Date('2026-09-27T10:00:00Z');
  assert.equal(state.rewards.levelHighWater, 4);
  assert.equal(assessAccount(state, nextDay).level, 4, 'analytics expiry cannot change the action level');
  for (const action of [
    { type: 'language', language: 'en' },
    { type: 'settings', username: 'soap628', posts: 3, replies: 15 },
    { type: 'heartbeat', username: 'soap628' },
    { type: 'tracking', enabled: false },
    { type: 'capture', username: 'soap628', followers: { value: 0 } }
  ]) assert.deepEqual(dispatch(state, action, nextDay).rewards, state.rewards, action.type);
  const changedLanguage = dispatch(state, { type: 'language', language: 'en' }, nextDay);
  const grew = dispatch(changedLanguage, { type: 'adjust', kind: 'posts', amount: 1 }, nextDay);
  assert.deepEqual(grew.rewards.earned.map(event => event.id), ['level:5']);
  assert.equal(grew.rewards.levelHighWater, assessAccount(grew, nextDay).level);
});

test('clock rollback skips settlement so reward records remain valid and can be restored', () => {
  const state = setup(), priorDate = new Date('2026-09-25T10:00:00Z');
  const action = { type: 'daily', date: '2026-09-25', posts: 1000, note: '' };
  const result = dispatch(state, action, priorDate);
  assert.ok(assessAccount(result, priorDate).level > state.rewards.levelHighWater);
  assert.deepEqual(result.rewards, state.rewards);
  assert.doesNotThrow(() => validateBackup(JSON.parse(JSON.stringify(result))));
});

test('restoring an early empty backup cannot carry retained rewards or milestone history to another account', () => {
  const bound = initializeRewards(reduce(newState(), { type: 'bind', username: 'account_a' }, now), now);
  const earlyBackup = JSON.parse(JSON.stringify(bound));
  const grown = dispatch(bound, { type: 'daily', date, posts: 200, note: '' });
  const restored = dispatch(grown, { type: 'import', data: earlyBackup }, later);
  assert.equal(Object.keys(restored.days).length, 0);
  assert.equal(Object.keys(restored.posts).length, 0);
  assert.equal(restored.account.blueVerified, null);
  assert.equal(restored.analyticsSummary, null);
  assert.equal(restored.rewards.earned.length, 2);
  assert.throws(() => dispatch(restored, { type: 'settings', username: 'account_b', posts: 2, replies: 10 }, later), /已有数据已绑定当前账号/);
  const migrated = initializeRewards({ ...grown, rewards: null }, now);
  const baselineOnly = dispatch(migrated, { type: 'import', data: earlyBackup }, later);
  assert.equal(baselineOnly.rewards.earned.length, 0);
  assert.ok(baselineOnly.rewards.levelHighWater > 1);
  assert.throws(() => dispatch(baselineOnly, { type: 'settings', username: 'account_b', posts: 2, replies: 10 }, later), /已有数据已绑定当前账号/);
  const sameAccount = dispatch(restored, { type: 'settings', username: 'account_a', posts: 3, replies: 15 }, later);
  assert.equal(sameAccount.settings.posts, 3);
  assert.deepEqual(sameAccount.rewards, restored.rewards);
});
