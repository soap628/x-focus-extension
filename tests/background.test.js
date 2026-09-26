import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState, STORAGE_KEY } from '../core.js';
let listener, installed;
const storage = { [STORAGE_KEY]: newState() };
globalThis.chrome = {
  sidePanel: { setPanelBehavior: async () => {} },
  runtime: { id: 'test-extension', getURL: file => `chrome-extension://test-extension/${file}`, onInstalled: { addListener(fn) { installed = fn; } }, onMessage: { addListener(fn) { listener = fn; } } },
  storage: { local: { async get() { await new Promise(resolve => setTimeout(resolve, 1)); return structuredClone(storage); }, async set(value) { await new Promise(resolve => setTimeout(resolve, 1)); Object.assign(storage, structuredClone(value)); } } }
};
await import('../background.js');
const panel = { id: chrome.runtime.id, url: chrome.runtime.getURL('sidepanel.html') };
const xTab = { id: chrome.runtime.id, url: 'https://x.com/soap628', tab: { id: 42 } };
const dispatch = (message, sender = panel) => new Promise(resolve => listener(message, sender, resolve));
test('background serializes simultaneous increments from multiple panels', async () => {
  installed();
  const results = await Promise.all(Array.from({ length: 25 }, () => dispatch({ type: 'adjust', kind: 'replies', amount: 1 })));
  assert.ok(results.every(r => r.ok));
  const response = await dispatch({ type: 'get' });
  assert.equal(Object.values(response.state.days)[0].replies, 25);
});
test('content scripts cannot change settings, import backups or read full state', async () => {
  for (const type of ['settings', 'import', 'get', 'adjust']) { const response = await dispatch({ type }, xTab); assert.equal(response.ok, false); }
  const response = await dispatch({ type: 'capture', username: 'test' }, { ...xTab, url: 'https://elsewhere.test/' });
  assert.equal(response.ok, false);
});
test('a rejected action does not poison the storage queue', async () => {
  assert.equal((await dispatch({ type: 'unknown' })).ok, false);
  assert.equal((await dispatch({ type: 'get' })).ok, true);
});
test('capture responses reveal only public configuration, not private notes or full storage', async () => {
  const response = await dispatch({ type: 'bind', username: 'soap628' }, xTab);
  assert.equal(response.ok, true); assert.equal(response.state, undefined); assert.equal(response.config.username, 'soap628');
  const capture = await dispatch({ type: 'capture', username: 'soap628', followers: { value: 123, approximate: false } }, xTab);
  assert.equal(capture.ok, true); assert.equal(capture.state, undefined);
});
test('HUD can change only daily goals and corrections, never account identity or full storage', async () => {
  const changed = await dispatch({ type: 'hud-command', command: 'goals', posts: 3, replies: 12, username: 'different' }, xTab);
  assert.equal(changed.ok, true); assert.equal(changed.hud.goals.posts, 3); assert.equal(changed.hud.username, 'soap628');
  assert.equal(changed.state, undefined); assert.equal(changed.hud.days, undefined);
  const before = changed.hud.posts;
  const added = await dispatch({ type: 'hud-command', command: 'adjust', kind: 'posts', amount: 1 }, xTab);
  assert.equal(added.hud.posts, before + 1);
  assert.equal((await dispatch({ type: 'hud-command', command: 'adjust', kind: 'posts', amount: 100 }, xTab)).ok, false);
  assert.equal((await dispatch({ type: 'hud-command', command: 'import' }, xTab)).ok, false);
  assert.equal((await dispatch({ type: 'hud-command', command: 'goals', posts: -1, replies: 12 }, xTab)).ok, false);
});
test('HUD read endpoint works only on X and returns display values', async () => {
  const result = await dispatch({ type: 'hud' }, xTab);
  assert.equal(result.ok, true); assert.equal(result.hud.goals.posts, 3); assert.equal(result.state, undefined);
  assert.equal((await dispatch({ type: 'hud' }, { ...xTab, url: 'https://elsewhere.test/' })).ok, false);
});

test('the extension options page can read its data when opened in a browser tab', async () => {
  const response = await dispatch({ type: 'get' }, { ...panel, tab: { id: 91 }, url: `${panel.url}?settings=1` });
  assert.equal(response.ok, true);
  assert.equal(response.state.settings.username, 'soap628');
  for (const url of ['https://x.com/sidepanel.html', 'chrome-extension://another-extension/sidepanel.html', `${panel.url}/not-the-options-page`]) {
    assert.equal((await dispatch({ type: 'get' }, { ...panel, tab: { id: 91 }, url })).ok, false);
  }
});
