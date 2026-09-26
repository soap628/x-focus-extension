import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState, reduce, STORAGE_KEY, dayKey } from '../core.js';
import { LOCAL_BACKUP_KEY } from '../local-backup.js';

let listener, failMeta = false, sequence = 0;
const now = new Date();
let state = reduce(newState(), { type: 'settings', username: 'soap628', posts: 2, replies: 10 }, new Date(now.getTime() - 60_000));
state = reduce(state, { type: 'adjust', kind: 'posts', amount: 1 }, now);
const storage = { [STORAGE_KEY]: state }, downloads = new Map(), createdTabs = [], alarmCallbacks = [], downloadCallbacks = [];
globalThis.chrome = {
  runtime: { id: 'test-extension', getURL: file => `chrome-extension://test-extension/${file}`, onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
  storage: { local: {
    async get(key) { if (failMeta && key === LOCAL_BACKUP_KEY) throw new Error('Metadata unavailable'); return structuredClone(storage); },
    async set(value) { if (failMeta && Object.hasOwn(value, LOCAL_BACKUP_KEY)) throw new Error('Metadata unavailable'); Object.assign(storage, structuredClone(value)); }
  } },
  alarms: { async create() {}, async clear() {}, onAlarm: { addListener(fn) { alarmCallbacks.push(fn); } } },
  downloads: {
    async download(options) { const id = ++sequence; downloads.set(id, { id, state: 'in_progress', filename: options.filename, options }); return id; },
    async search(query) { return [...downloads.values()].filter(item => query.id === undefined || item.id === query.id); },
    show() {}, onChanged: { addListener(fn) { downloadCallbacks.push(fn); } }
  },
  tabs: { async create(options) { createdTabs.push(options); } }
};
await import('../background.js');
const panel = { id: chrome.runtime.id, url: chrome.runtime.getURL('sidepanel.html#backup') };
const xTab = { id: chrome.runtime.id, url: 'https://x.com/home', tab: { id: 42 } };
const dispatch = (message, sender = panel) => new Promise(resolve => listener(message, sender, resolve));

test('only the extension options page controls or inspects disk backups', async () => {
  for (const type of ['backup-status', 'backup-now', 'backup-setting', 'backup-show']) {
    assert.equal((await dispatch({ type, enabled: false }, xTab)).ok, false, type);
  }
  assert.equal((await dispatch({ type: 'hud-command', command: 'backup-now' }, xTab)).ok, false);
  const status = await dispatch({ type: 'backup-status' });
  assert.equal(status.ok, true); assert.equal(status.backup.enabled, true);
  assert.equal((await dispatch({ type: 'backup-setting', enabled: 'true' })).ok, false);
  const response = await dispatch({ type: 'hud' }, xTab);
  assert.equal(response.backup, undefined); assert.equal(response.state, undefined);
  assert.doesNotMatch(JSON.stringify(response), /X-Focus\/|Signature|downloadId/);
});

test('the HUD may open backup options but cannot choose another URL or receive the file data', async () => {
  const response = await dispatch({ type: 'hud-command', command: 'open-backups', url: 'https://other.test/' }, xTab);
  assert.equal(response.ok, true);
  assert.deepEqual(createdTabs.at(-1), { url: chrome.runtime.getURL('sidepanel.html#backup') });
  assert.equal(response.backup, undefined); assert.equal(response.state, undefined);
});

test('a backup command exports a complete local JSON and reports saved only after download completion', async () => {
  const response = await dispatch({ type: 'backup-now' });
  assert.equal(response.ok, true); assert.equal(response.backup.status, 'saving');
  assert.equal(response.backup.lastSuccessAt, null);
  const download = downloads.get(response.backup.downloadId);
  assert.match(download.options.url, /^data:application\/json/);
  const json = JSON.parse(decodeURIComponent(download.options.url.slice(download.options.url.indexOf(',') + 1)));
  assert.equal(json.days[dayKey(now)].posts, 1);
  assert.equal(json.tracking.startedAt, storage[STORAGE_KEY].tracking.startedAt);
  download.state = 'complete';
  downloadCallbacks.forEach(fn => fn({ id: download.id, state: { current: 'complete' } }));
  const completed = await dispatch({ type: 'backup-status' });
  assert.equal(completed.backup.status, 'saved');
  assert.equal(completed.backup.lastCompletedSignature, response.backup.requestedSignature);
});

test('backup metadata failures never turn a successfully saved action into an error or a retry', async () => {
  failMeta = true;
  const before = storage[STORAGE_KEY].days[dayKey(now)].replies;
  const response = await dispatch({ type: 'adjust', kind: 'replies', amount: 1 });
  assert.equal(response.ok, true);
  assert.equal(storage[STORAGE_KEY].days[dayKey(now)].replies, before + 1);
  assert.equal(response.state.days[dayKey(now)].replies, before + 1);
  failMeta = false;
});
