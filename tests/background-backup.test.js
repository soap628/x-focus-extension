import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState, reduce, STORAGE_KEY, dayKey } from '../core.js';
import { LOCAL_BACKUP_KEY } from '../local-backup.js';

let listener, installed, failMeta = false, metaFailures = 0, sequence = 0;
const now = new Date();
let state = reduce(newState(), { type: 'settings', username: 'soap628', posts: 2, replies: 10 }, new Date(now.getTime() - 60_000));
state = reduce(state, { type: 'adjust', kind: 'posts', amount: 1 }, now);
const storage = { [STORAGE_KEY]: state }, downloads = new Map(), createdTabs = [], alarmCallbacks = [], downloadCallbacks = [];
globalThis.chrome = {
  runtime: { id: 'test-extension', getURL: file => `chrome-extension://test-extension/${file}`, onInstalled: { addListener(fn) { installed = fn; } }, onMessage: { addListener(fn) { listener = fn; } } },
  storage: { local: {
    async get(key) { if (failMeta && key === LOCAL_BACKUP_KEY) { metaFailures++; throw new Error('Metadata unavailable'); } return structuredClone(storage); },
    async set(value) { if (failMeta && Object.hasOwn(value, LOCAL_BACKUP_KEY)) { metaFailures++; throw new Error('Metadata unavailable'); } Object.assign(storage, structuredClone(value)); }
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
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function bounded(promise, label, timeout = 3000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeout); })]); }
  finally { clearTimeout(timer); }
}

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
  const failuresBefore = metaFailures;
  const before = storage[STORAGE_KEY].days[dayKey(now)].replies;
  const response = await dispatch({ type: 'adjust', kind: 'replies', amount: 1 });
  assert.equal(response.ok, true);
  assert.equal(storage[STORAGE_KEY].days[dayKey(now)].replies, before + 1);
  assert.equal(response.state.days[dayKey(now)].replies, before + 1);
  const status = await bounded(dispatch({ type: 'backup-status' }), 'failed metadata processing');
  assert.ok(status.ok || status.error, 'the independent backup queue settles after a failure');
  assert.ok(metaFailures > failuresBefore, 'the queued backup really encountered a metadata failure');
  failMeta = false;
});

test('a held download cannot block installation, consecutive network/page actions, panel changes or state reads', async () => {
  const originalDownload = chrome.downloads.download;
  const entered = deferred(), release = deferred();
  chrome.downloads.download = async options => {
    const id = await originalDownload(options);
    entered.resolve(id);
    await release.promise;
    return id;
  };
  const backupRequest = dispatch({ type: 'backup-now' });
  let statusRequest, downloadId;
  try {
    downloadId = await bounded(entered.promise, 'download start');
    let statusResolved = false;
    statusRequest = dispatch({ type: 'backup-status' }).then(value => { statusResolved = true; return value; });
    const before = structuredClone(storage[STORAGE_KEY]);
    const date = dayKey(new Date());
    const beforePosts = before.days[date]?.posts || 0, beforeReplies = before.days[date]?.replies || 0;
    const createdAt = new Date().toISOString();
    const ownPost = (id, kind) => ({ id, kind, createdAt, views: null, text: 'Activity while a download waits' });
    const capturedAtResponse = [];
    const record = message => new Promise(resolve => listener(message, xTab, response => {
      capturedAtResponse.push({ response, persisted: structuredClone(storage[STORAGE_KEY]) }); resolve(response);
    }));
    installed();
    const answers = await bounded(Promise.all([
      record({ type: 'network', username: 'soap628', posts: [ownPost('91000001', 'posts')] }),
      record({ type: 'capture', username: 'soap628', posts: [ownPost('91000002', 'replies')] }),
      record({ type: 'network', username: 'soap628', posts: [ownPost('91000003', 'posts')] }),
      dispatch({ type: 'adjust', kind: 'replies', amount: 1 }),
      dispatch({ type: 'get' })
    ]), 'ledger operations while download is held');
    assert.ok(answers.every(answer => answer.ok));
    assert.equal(statusResolved, false, 'the backup queue really is held while the action ledger remains live');
    assert.equal(answers.at(-1).state.days[date].posts, beforePosts + 2);
    assert.equal(answers.at(-1).state.days[date].replies, beforeReplies + 2);
    assert.equal(answers.at(-1).backup, undefined);
    assert.equal(answers.at(-2).backup, undefined);
    for (const { response, persisted } of capturedAtResponse) {
      assert.equal(response.hud.posts, persisted.days[date].posts);
      assert.equal(response.hud.replies, persisted.days[date].replies);
    }
    assert.deepEqual(storage[STORAGE_KEY].days[date].loggedPostIds.slice(-3), ['91000001', '91000002', '91000003']);
  } finally {
    release.resolve();
    chrome.downloads.download = originalDownload;
    const result = await bounded(backupRequest, 'released download');
    downloadId ??= result.backup?.downloadId;
    if (downloadId) {
      downloads.get(downloadId).state = 'complete';
      downloadCallbacks.forEach(fn => fn({ id: downloadId, state: { current: 'complete' } }));
    }
    if (statusRequest) await bounded(statusRequest, 'released status lookup');
    await bounded(dispatch({ type: 'backup-status' }), 'backup cleanup');
  }
});

test('action success is still withheld until its main local-storage write completes', async () => {
  const originalSet = chrome.storage.local.set;
  const entered = deferred(), release = deferred();
  const date = dayKey(new Date()), before = storage[STORAGE_KEY].days[date].posts;
  let held = false, answered = false;
  chrome.storage.local.set = async value => {
    if (!held && Object.hasOwn(value, STORAGE_KEY)) { held = true; entered.resolve(); await release.promise; }
    return originalSet(value);
  };
  const action = dispatch({ type: 'adjust', kind: 'posts', amount: 1 }).then(response => {
    answered = true;
    assert.equal(storage[STORAGE_KEY].days[date].posts, before + 1);
    return response;
  });
  try {
    await bounded(entered.promise, 'primary storage write');
    assert.equal(answered, false);
    assert.equal(storage[STORAGE_KEY].days[date].posts, before);
  } finally {
    release.resolve();
    chrome.storage.local.set = originalSet;
  }
  assert.equal((await bounded(action, 'committed action response')).ok, true);
  await bounded(dispatch({ type: 'backup-status' }), 'backup queue drain');
});
