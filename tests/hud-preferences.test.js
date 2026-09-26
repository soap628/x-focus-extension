import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState, reduce, upgradeState, validateBackup, validateHudPreferences, STORAGE_KEY } from '../core.js';
import { hudAction, hudSummary } from '../hud-state.js';
import { initializeRewards, settleRewards } from '../rewards.js';

const now = new Date('2026-09-26T10:00:00Z');
const later = new Date('2026-09-26T11:00:00Z');
const defaults = { mode: 'mini', position: null };
const position = { anchor: 'right', x: 1, y: 0.4 };
const action = preferences => ({ type: 'hud-preferences', preferences });
function setup() {
  let state = reduce(newState(), { type: 'settings', username: 'soap628', posts: 2, replies: 10 }, now);
  state = reduce(state, { type: 'daily', date: '2026-09-26', posts: 19, replies: 4, followers: 3000, note: 'private journal' }, now);
  return initializeRewards(state, now);
}
const withoutPreferences = state => { const copy = structuredClone(state); delete copy.hudPreferences; return copy; };

test('new and legacy states default to a mini HUD with automatic placement', () => {
  assert.deepEqual(newState().hudPreferences, defaults);
  const first = newState(), second = newState(); first.hudPreferences.mode = 'full';
  assert.equal(second.hudPreferences.mode, 'mini');
  const legacy = setup(); delete legacy.hudPreferences;
  for (const version of [1, 2]) {
    const old = { ...legacy, version };
    for (const migrated of [upgradeState(old, later), validateBackup(old), reduce(newState(), { type: 'import', data: old }, later)]) {
      assert.deepEqual(migrated.hudPreferences, defaults);
      assert.deepEqual(withoutPreferences(migrated), { ...legacy, version: 2 });
    }
  }
});

test('layout patches merge independently and cannot change history, XP, goals or rewards', () => {
  const initial = setup();
  let state = reduce(initial, action({ mode: 'full' }), later);
  state = settleRewards(initial, state, action({ mode: 'full' }), later);
  state = reduce(state, action({ position }), later);
  assert.deepEqual(state.hudPreferences, { mode: 'full', position });
  assert.deepEqual(withoutPreferences(state), withoutPreferences(initial));
  assert.equal(hudSummary(state, later).totalXp, 99);
  state = reduce(state, action({ mode: 'mini' }), later);
  assert.deepEqual(state.hudPreferences, { mode: 'mini', position });
  state = reduce(state, action({ position: null }), later);
  assert.deepEqual(state.hudPreferences, defaults);
  assert.deepEqual(initial.hudPreferences, defaults, 'the input state remains immutable');
});

test('HUD commands return only validated layout patches and summaries return a safe copy', () => {
  const state = setup();
  const requested = { mode: 'full', position: { ...position } };
  const command = hudAction({ command: 'hud-preferences', preferences: requested, username: 'another', posts: 999, rewards: { earned: [] } }, state);
  assert.deepEqual(command, action(requested));
  requested.position.y = 0.9;
  assert.equal(command.preferences.position.y, 0.4);
  const next = reduce(state, command, now), summary = hudSummary(next, now);
  summary.hudPreferences.position.x = 0;
  assert.equal(next.hudPreferences.position.x, 1);
  assert.ok(!JSON.stringify(summary).includes('private journal'));
  assert.equal(next.settings.username, 'soap628');
  assert.throws(() => hudAction({ command: 'hud-preferences' }, state));
});

test('normalized coordinates accept endpoints and fractions with an explicit anchor', () => {
  for (const anchor of ['left', 'right', 'free']) for (const x of [0, 0.125, 1]) for (const y of [0, 0.75, 1]) {
    const preferences = { mode: 'full', position: { anchor, x, y } };
    assert.deepEqual(validateHudPreferences(preferences), preferences);
    assert.deepEqual(reduce(setup(), action(preferences), now).hudPreferences, preferences);
  }
  assert.deepEqual(validateHudPreferences({ position: null }, true), { position: null });
});

test('missing, unsupported, prototype-bearing and non-finite layout patches fail closed', () => {
  const invalid = [undefined, null, false, '', [], {}, { mode: undefined }, { mode: null }, { mode: 'hidden' }, { mode: 'full', posts: 100 }, { position: undefined }, { position: {} }, { position: [] }, { position: { anchor: 'right', x: 1 } }, { position: { anchor: 'top', x: 0, y: 0 } }, { position: { anchor: 'free', x: 0, y: 0, width: 9999 } }, JSON.parse('{"__proto__":{"mode":"full"}}'), { position: JSON.parse('{"anchor":"free","x":0,"y":0,"__proto__":{"polluted":true}}') }, { position: Object.create({ anchor: 'right', x: 1, y: 0 }) }];
  for (const value of [-0.01, 1.01, NaN, Infinity, -Infinity, '0.5', null, false]) {
    invalid.push({ position: { anchor: 'free', x: value, y: 0 } }, { position: { anchor: 'free', x: 0, y: value } });
  }
  for (const preferences of invalid) {
    assert.throws(() => validateHudPreferences(preferences, true));
    assert.throws(() => reduce(setup(), action(preferences), now));
    assert.throws(() => hudAction({ command: 'hud-preferences', preferences }, setup()));
  }
  assert.equal({}.polluted, undefined);
});

test('backup roundtrips preserve saved placement and reject malformed full preferences', () => {
  const state = reduce(setup(), action({ mode: 'full', position }), now);
  const restored = reduce(newState(), { type: 'import', data: JSON.parse(JSON.stringify(state)) }, later);
  assert.deepEqual(restored, state);
  for (const hudPreferences of [null, [], {}, { mode: 'full' }, { position }, { mode: 'mini', position: { anchor: 'free', x: Infinity, y: 0 } }, { mode: 'full', position, tracking: { enabled: false } }]) assert.throws(() => validateBackup({ ...state, hudPreferences }));
});

test('first read persists legacy defaults; concurrent tabs merge patches and restart keeps the result', async () => {
  const legacy = setup(); delete legacy.hudPreferences;
  const storage = { [STORAGE_KEY]: structuredClone(legacy) };
  let listener, installed, writes = 0;
  const notifications = [];
  globalThis.chrome = {
    runtime: { id: 'hud-preferences-test', getURL: file => 'chrome-extension://hud-preferences-test/' + file, onInstalled: { addListener(fn) { installed = fn; } }, onMessage: { addListener(fn) { listener = fn; } } },
    storage: { local: { async get() { await new Promise(resolve => setTimeout(resolve, 1)); return structuredClone(storage); }, async set(value) { await new Promise(resolve => setTimeout(resolve, 1)); writes++; Object.assign(storage, structuredClone(value)); } } },
    tabs: { async query() { return [{ id: 1 }, { id: 2 }]; }, async sendMessage(tab, message) { notifications.push({ tab, message }); } }
  };
  const xTab = id => ({ id: chrome.runtime.id, url: 'https://x.com/home', tab: { id } });
  const send = (message, id = 1) => new Promise(resolve => listener(message, xTab(id), resolve));
  const preferences = (value, id) => send({ type: 'hud-command', command: 'hud-preferences', preferences: value }, id);
  await import('../background.js?hud-preferences=1');
  const initial = await send({ type: 'hud' });
  assert.equal(initial.ok, true); assert.deepEqual(initial.hud.hudPreferences, defaults);
  assert.deepEqual(storage[STORAGE_KEY].hudPreferences, defaults); assert.equal(writes, 1);
  assert.deepEqual(withoutPreferences(storage[STORAGE_KEY]), legacy);
  const results = await Promise.all([preferences({ mode: 'full' }, 1), preferences({ position }, 2)]);
  assert.ok(results.every(result => result.ok));
  assert.deepEqual(storage[STORAGE_KEY].hudPreferences, { mode: 'full', position });
  assert.deepEqual(withoutPreferences(storage[STORAGE_KEY]), legacy);
  assert.ok(notifications.some(event => event.tab === 1 && event.message.hud.hudPreferences.position?.y === 0.4));
  assert.ok(notifications.some(event => event.tab === 2 && event.message.hud.hudPreferences.mode === 'full'));
  await Promise.all([preferences({ position: { anchor: 'left', x: 0, y: 0.75 } }, 2), preferences({ mode: 'mini' }, 1)]);
  const saved = structuredClone(storage[STORAGE_KEY]);
  assert.deepEqual(saved.hudPreferences, { mode: 'mini', position: { anchor: 'left', x: 0, y: 0.75 } });
  await import('../background.js?hud-preferences=2'); installed();
  const restarted = await send({ type: 'hud' }, 2);
  assert.deepEqual(restarted.hud.hudPreferences, saved.hudPreferences); assert.deepEqual(storage[STORAGE_KEY], saved);
  assert.equal((await preferences({ position: { anchor: 'free', x: NaN, y: 0 } }, 1)).ok, false);
  assert.deepEqual(storage[STORAGE_KEY], saved);
  assert.equal((await send({ type: 'hud-preferences', preferences: { mode: 'full' } })).ok, false, 'raw page actions remain unauthorized');
  assert.equal((await preferences({ mode: 'full', settings: { username: 'another' } })).ok, false);
  assert.equal((await send({ type: 'hud' })).hud.totalXp, 99);
});
