import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState, reduce, validateBackup } from '../core.js';
import { createLocalBackup, LOCAL_BACKUP_KEY, BACKUP_ALARM, BACKUP_SAFETY_ALARM, MAX_BACKUP_BYTES } from '../local-backup.js';

const date = new Date('2026-09-26T10:00:00.123Z');
const meaningful = () => reduce(reduce(newState(), { type: 'settings', username: 'soap628', posts: 2, replies: 10 }, date), { type: 'daily', date: '2026-09-26', posts: 1, replies: 0, followers: 123, note: '' }, date);
function setup(initial = meaningful(), savedMeta) {
  let state = structuredClone(initial), clock = date.getTime(), id = 0;
  const values = savedMeta ? { [LOCAL_BACKUP_KEY]: structuredClone(savedMeta) } : {};
  const alarms = new Map(), records = new Map(), downloadCalls = [], shown = [], canceled = [];
  const listeners = { download: [], alarm: [] };
  let failDownload = null;
  const chrome = {
    storage: { local: { async get(key) { return { [key]: structuredClone(values[key]) }; }, async set(value) { Object.assign(values, structuredClone(value)); } } },
    alarms: {
      async create(name, options) { alarms.set(name, options); }, async clear(name) { return alarms.delete(name); },
      onAlarm: { addListener(fn) { listeners.alarm.push(fn); } },
    },
    downloads: {
      async download(options) {
        downloadCalls.push(options);
        if (failDownload) throw new Error(failDownload);
        const next = ++id;
        records.set(next, { id: next, state: 'in_progress', startTime: new Date(clock).toISOString(), filename: `C:\\Downloads\\${options.filename.replaceAll('/', '\\')}` });
        return next;
      },
      async search(query) { return [...records.values()].filter(item => query.id === undefined || item.id === query.id).map(item => ({ ...item })); },
      async cancel(downloadId) { canceled.push(downloadId); const item = records.get(downloadId); if (item?.state === 'in_progress') { item.state = 'interrupted'; item.error = 'USER_CANCELED'; } },
      async show(downloadId) { shown.push(downloadId); },
      onChanged: { addListener(fn) { listeners.download.push(fn); } },
    },
  };
  const create = () => createLocalBackup({ chrome, getState: async () => structuredClone(state), now: () => new Date(clock) });
  let engine = create();
  return {
    get engine() { return engine; }, chrome, values, alarms, records, downloadCalls, shown, canceled,
    get state() { return state; }, set state(value) { state = structuredClone(value); },
    advance(ms) { clock += ms; }, fail(message) { failDownload = message; },
    restart() { listeners.download = []; listeners.alarm = []; engine = create(); return engine; },
    async alarm(name = BACKUP_ALARM) { for (const fn of listeners.alarm) fn({ name }); return engine.status(); },
    async finish(downloadId, downloadState = 'complete', error = undefined) {
      const item = records.get(downloadId); if (item) Object.assign(item, { state: downloadState, error });
      for (const fn of listeners.download) fn({ id: downloadId, state: { current: downloadState }, ...(error ? { error: { current: error } } : {}) });
      return engine.status();
    },
  };
}

test('missing Chrome capabilities report unavailable without touching storage or alarms', async () => {
  const engine = createLocalBackup({ chrome: {}, getState: async () => newState() });
  assert.equal((await engine.start()).status, 'unavailable');
  assert.equal((await engine.changed(meaningful())).status, 'unavailable');
  assert.equal((await engine.runNow()).status, 'unavailable');
  assert.equal((await engine.setEnabled(false)).enabled, false);
  assert.equal((await engine.showFile()).status, 'unavailable');
});

test('initial empty installs and tracking heartbeats create no empty snapshots', async () => {
  const h = setup(newState());
  h.state.tracking.startedAt = date.toISOString();
  assert.equal((await h.engine.start()).status, 'idle');
  assert.deepEqual(h.alarms.get(BACKUP_SAFETY_ALARM), { periodInMinutes: 5 });
  assert.equal(h.alarms.has(BACKUP_ALARM), false);
  await h.engine.runNow(); await h.alarm(BACKUP_SAFETY_ALARM);
  assert.equal(h.downloadCalls.length, 0);
  h.state.settings.username = 'soap628';
  await h.engine.changed(h.state); await h.engine.runNow();
  assert.equal(h.downloadCalls.length, 0, 'an identified account alone is still empty');
});

test('business changes coalesce for one minute and persist metadata without a JSON payload', async () => {
  const h = setup();
  const first = await h.engine.start();
  assert.equal(first.status, 'pending');
  const scheduled = h.alarms.get(BACKUP_ALARM).when;
  assert.equal(scheduled, date.getTime() + 60_000);
  h.advance(20_000); h.state.settings.posts = 4;
  await h.engine.changed(h.state);
  assert.equal(h.alarms.get(BACKUP_ALARM).when, scheduled);
  assert.equal(h.downloadCalls.length, 0);
  const meta = h.values[LOCAL_BACKUP_KEY];
  assert.equal(meta.currentSignature.length, 64);
  assert.ok(!JSON.stringify(meta).includes('soap628'));
  assert.ok(!JSON.stringify(meta).includes('data:'));
  h.advance(40_000);
  assert.equal((await h.alarm()).status, 'saving');
  assert.equal(h.downloadCalls.length, 1);
});

test('a completed disk download is required before reporting success and exporting an importable full state', async () => {
  const h = setup();
  h.state = reduce(h.state, { type: 'daily', date: '2026-09-26', posts: 3, replies: 9, followers: 123, note: 'local journal' }, date);
  h.state.hudPreferences = { mode: 'full', position: { anchor: 'left', x: 0, y: 0.4 } };
  h.state.days['2026-09-26'].loggedPostIds = ['20260000000000001'];
  const running = await h.engine.runNow();
  assert.equal(running.status, 'saving');
  assert.equal(running.lastSuccessAt, null);
  assert.equal(running.lastCompletedDownloadId, null);
  assert.equal(running.dirty, true);
  const options = h.downloadCalls[0];
  assert.equal(options.saveAs, false); assert.equal(options.conflictAction, 'uniquify');
  assert.match(options.filename, /^X-Focus\/soap628\/x-focus-2026-09-26T10-00-00-123Z-[0-9a-f]{12}\.json$/);
  const exported = JSON.parse(decodeURIComponent(options.url.split(',').slice(1).join(',')));
  assert.deepEqual(exported, h.state);
  assert.equal(validateBackup(exported).days['2026-09-26'].posts, 3);
  const finished = await h.finish(running.downloadId);
  assert.equal(finished.status, 'saved'); assert.equal(finished.dirty, false);
  assert.equal(finished.lastSuccessAt, date.toISOString());
  assert.equal(finished.lastCompletedDownloadId, running.downloadId);
  assert.equal(finished.filename, options.filename);
  await h.engine.showFile(); assert.deepEqual(h.shown, [running.downloadId]);
});

test('identical capture values and volatile observation timestamps do not generate repeated files', async () => {
  const h = setup();
  h.state.account.blueVerified = { value: true, source: 'network', at: date.toISOString() };
  h.state.posts.p = { id: 'p', views: 9, createdAt: date.toISOString(), observedAt: date.toISOString() };
  const running = await h.engine.runNow(); await h.finish(running.downloadId);
  h.advance(100_000);
  const later = new Date(date.getTime() + 100_000).toISOString();
  Object.assign(h.state.tracking, { lastNetworkAt: later, lastPageAt: later, lastPublishAt: later });
  h.state.lastCapture = later; h.state.account.blueVerified.at = later; h.state.posts.p.observedAt = later;
  assert.equal((await h.engine.changed(h.state)).dirty, false);
  await h.alarm(BACKUP_SAFETY_ALARM);
  assert.equal(h.downloadCalls.length, 1);
  h.state.posts.p.views = 10;
  assert.equal((await h.engine.changed(h.state)).dirty, true);
});

test('completion of an older snapshot cannot clear changes made during its download', async () => {
  const h = setup(), first = await h.engine.runNow();
  h.state.settings.replies = 20;
  await h.engine.changed(h.state);
  const requested = await h.engine.runNow();
  assert.equal(requested.downloadId, first.downloadId);
  assert.notEqual(requested.requestedSignature, requested.inFlightSignature);
  assert.notEqual(requested.requestedSignature, requested.lastCompletedSignature);
  const finished = await h.finish(first.downloadId);
  assert.equal(finished.status, 'pending'); assert.equal(finished.dirty, true);
  h.advance(60_000);
  const second = await h.alarm();
  assert.notEqual(second.downloadId, first.downloadId);
  assert.equal(h.downloadCalls.length, 2);
  const latest = await h.finish(second.downloadId);
  assert.equal(latest.dirty, false);
  assert.equal(latest.lastCompletedSignature, requested.requestedSignature);
});

test('interrupted and rejected downloads preserve data and throttle automatic retries to five minutes', async () => {
  for (const rejected of [false, true]) {
    const h = setup();
    if (rejected) h.fail('FILE_ACCESS_DENIED');
    let result = await h.engine.runNow();
    if (!rejected) result = await h.finish(result.downloadId, 'interrupted', 'FILE_ACCESS_DENIED');
    assert.equal(result.status, 'error'); assert.equal(result.lastSuccessAt, null); assert.equal(result.dirty, true);
    assert.equal(Date.parse(result.nextRunAt), date.getTime() + 300_000);
    h.advance(60_000); h.state.settings.posts++;
    await h.engine.changed(h.state); await h.alarm();
    assert.equal(h.downloadCalls.length, 1);
    h.advance(240_000); h.fail(null);
    assert.equal((await h.alarm(BACKUP_SAFETY_ALARM)).status, 'saving');
    assert.equal(h.downloadCalls.length, 2);
  }
});

test('manual retry bypasses the background cooldown without deleting or overwriting earlier files', async () => {
  const h = setup();
  const first = await h.engine.runNow(); await h.finish(first.downloadId);
  h.state.settings.posts++;
  h.fail('NETWORK_FAILED'); await h.engine.runNow();
  h.fail(null); const retry = await h.engine.runNow();
  assert.equal(retry.status, 'saving');
  assert.equal(retry.lastCompletedDownloadId, first.downloadId);
  assert.equal(h.downloadCalls.length, 3);
  assert.equal(new Set(h.downloadCalls.map(call => call.filename)).size, 3);
  assert.ok(h.records.has(first.downloadId));
});

test('worker restart recovers pending IDs, completed files, and newer state from local storage', async () => {
  const h = setup(), running = await h.engine.runNow();
  assert.equal((await h.restart().start()).status, 'saving');
  h.records.get(running.downloadId).state = 'complete';
  h.state.settings.posts = 8;
  const restored = await h.restart().start();
  assert.equal(restored.lastCompletedDownloadId, running.downloadId);
  assert.equal(restored.dirty, true); assert.equal(restored.status, 'pending');
  assert.equal(h.downloadCalls.length, 1);
  assert.ok(h.alarms.has(BACKUP_ALARM));
});

test('worker restart finds a download whose ID could not be stored before suspension', async () => {
  const h = setup(), running = await h.engine.runNow();
  h.values[LOCAL_BACKUP_KEY].downloadId = null;
  h.records.get(running.downloadId).state = 'complete';
  const restored = await h.restart().start();
  assert.equal(restored.status, 'saved');
  assert.equal(restored.lastCompletedDownloadId, running.downloadId);
  assert.equal(h.downloadCalls.length, 1);
});

test('missing download history and unrelated download events cannot claim a successful backup', async () => {
  const h = setup(), running = await h.engine.runNow();
  await h.finish(9999);
  assert.equal((await h.engine.status()).status, 'saving');
  h.records.delete(running.downloadId);
  const restored = await h.restart().start();
  assert.equal(restored.status, 'error'); assert.equal(restored.lastSuccessAt, null);
  assert.equal(restored.dirty, true);
});

test('disabled automatic backup persists across workers while explicit manual backup remains available', async () => {
  const h = setup(); await h.engine.start();
  assert.equal((await h.engine.setEnabled(false)).status, 'disabled');
  assert.equal(h.alarms.size, 0);
  h.state.settings.posts++;
  await h.engine.changed(h.state); await h.alarm(BACKUP_SAFETY_ALARM);
  assert.equal(h.downloadCalls.length, 0);
  assert.equal((await h.restart().start()).enabled, false);
  const running = await h.engine.runNow();
  assert.ok(running.downloadId); await h.finish(running.downloadId);
  assert.equal((await h.engine.status()).lastCompletedDownloadId, running.downloadId);
  assert.equal((await h.engine.setEnabled(true)).status, 'saved');
  assert.ok(h.alarms.has(BACKUP_SAFETY_ALARM));
  await assert.rejects(h.engine.setEnabled('false'));
});

test('the safety alarm backs up persisted changes missed by changed notifications', async () => {
  const h = setup(), running = await h.engine.runNow(); await h.finish(running.downloadId);
  h.advance(300_000); h.state.settings.language = 'en';
  assert.equal((await h.alarm(BACKUP_SAFETY_ALARM)).status, 'saving');
  assert.equal(h.downloadCalls.length, 2);
});

test('full snapshots retain rewards, preferences, tracking boundaries, and deduplication history', async () => {
  const h = setup();
  h.state.rewards = { initializedAt: date.toISOString(), earned: [{ id: 'one', openedAt: date.toISOString(), itemId: 'quill' }] };
  h.state.days['2026-09-26'] = { posts: 1, replies: 4, loggedPostIds: ['id-one'], trackedIds: ['id-two'] };
  await h.engine.runNow();
  const content = JSON.parse(decodeURIComponent(h.downloadCalls[0].url.split(',').slice(1).join(',')));
  assert.deepEqual(content, h.state);
  assert.ok(content.tracking.startedAt);
  const meta = JSON.stringify(h.values);
  for (const privateValue of ['id-one', 'id-two', 'quill', 'data:application']) assert.ok(!meta.includes(privateValue));
});

test('oversize JSON is rejected before download so every created backup can fit the restore limit', async () => {
  const h = setup(); h.state.note = '界'.repeat(Math.floor(MAX_BACKUP_BYTES / 3));
  const result = await h.engine.runNow();
  assert.equal(result.status, 'error'); assert.match(result.error, /16 MiB/);
  assert.equal(h.downloadCalls.length, 0);
});

test('a temporarily unavailable metadata store is retried without overwriting a disabled preference', async () => {
  const h = setup(); await h.engine.setEnabled(false);
  const originalGet = h.chrome.storage.local.get;
  let calls = 0;
  h.chrome.storage.local.get = async key => { if (++calls === 1) throw new Error('Storage temporarily unavailable'); return originalGet(key); };
  h.restart();
  await assert.rejects(h.engine.start(), /temporarily unavailable/);
  assert.equal((await h.engine.start()).enabled, false);
  assert.equal(h.values[LOCAL_BACKUP_KEY].enabled, false);
});

test('stalled downloads become visible errors and allow a bounded background retry', async () => {
  const h = setup(), running = await h.engine.runNow();
  h.advance(900_000);
  const stalled = await h.alarm(BACKUP_SAFETY_ALARM);
  assert.equal(stalled.status, 'error'); assert.match(stalled.error, /15 minutes/);
  assert.equal(h.downloadCalls.length, 1);
  h.advance(300_000);
  const retried = await h.alarm(BACKUP_SAFETY_ALARM);
  assert.equal(retried.status, 'saving'); assert.notEqual(retried.downloadId, running.downloadId);
  assert.equal(h.downloadCalls.length, 2);
});

test('Windows device names and unexpected path characters cannot make unsafe backup subdirectories', async () => {
  for (const username of ['CON', 'prn', 'AUX', 'nul', 'COM1', 'LPT9', '../../escape']) {
    const h = setup(); h.state.settings.username = username;
    await h.engine.runNow();
    const name = h.downloadCalls[0].filename;
    assert.equal(name.split('/').length, 3);
    assert.ok(!name.includes('..')); assert.ok(!name.includes('\\'));
    if (username !== '../../escape') assert.equal(name.split('/')[1], `_${username}`);
  }
});

test('automatic snapshots rotate two files per account and day only after successful completion', async () => {
  const h = setup(); await h.engine.start();
  const filenames = [];
  for (let round = 0; round < 5; round++) {
    h.advance(60_000); h.state.days['2026-09-26'].posts++;
    await h.engine.changed(h.state);
    const running = await h.alarm();
    const call = h.downloadCalls.at(-1);
    assert.equal(call.conflictAction, 'overwrite');
    assert.match(call.filename, /^X-Focus\/soap628\/x-focus-2026-09-26-[a-f0-9]{12}-auto-[AB]\.json$/);
    filenames.push(call.filename);
    await h.finish(running.downloadId);
  }
  assert.equal(new Set(filenames).size, 2);
  assert.deepEqual(filenames.map(name => name.slice(-6)), ['A.json', 'B.json', 'A.json', 'B.json', 'A.json']);
  assert.equal(h.values[LOCAL_BACKUP_KEY].autoSlots['soap628/2026-09-26'], 'A');
  h.advance(60_000); h.state.settings.posts++;
  await h.engine.changed(h.state); const failed = await h.alarm();
  const failedName = h.downloadCalls.at(-1).filename;
  await h.finish(failed.downloadId, 'interrupted', 'FILE_FAILED');
  assert.equal(h.values[LOCAL_BACKUP_KEY].autoSlots['soap628/2026-09-26'], 'A');
  h.advance(300_000); await h.alarm();
  assert.equal(h.downloadCalls.at(-1).filename, failedName, 'retry only overwrites the unsuccessful slot');
});

test('a new local day retains yesterday files and starts an independent automatic rotation', async () => {
  const h = setup(); await h.engine.start(); h.advance(60_000);
  const first = await h.alarm(); await h.finish(first.downloadId);
  const yesterday = h.downloadCalls[0].filename;
  h.advance(7 * 60 * 60_000); h.state.settings.posts++;
  await h.engine.changed(h.state); const next = await h.alarm(); await h.finish(next.downloadId);
  const today = h.downloadCalls[1].filename;
  assert.match(yesterday, /2026-09-26.*auto-A/);
  assert.match(today, /2026-09-27.*auto-A/, 'day uses configured Asia/Shanghai timezone');
  assert.notEqual(today, yesterday);
  assert.equal(Object.keys(h.values[LOCAL_BACKUP_KEY].autoSlots).length, 2);
});

test('fresh installs use an independent archive ID and never overwrite pre-reinstall automatic files', async () => {
  const h = setup(); await h.engine.start(); h.advance(60_000);
  const original = await h.alarm(); await h.finish(original.downloadId);
  const before = h.downloadCalls[0].filename;
  const archiveId = h.values[LOCAL_BACKUP_KEY].archiveId;
  delete h.values[LOCAL_BACKUP_KEY];
  await h.restart().start(); h.advance(60_000);
  await h.alarm();
  assert.notEqual(h.values[LOCAL_BACKUP_KEY].archiveId, archiveId);
  assert.notEqual(h.downloadCalls[1].filename, before);
  assert.ok(h.records.has(original.downloadId));
});

test('manual snapshots remain immutable and do not advance or overwrite automatic slots', async () => {
  const h = setup(); await h.engine.start(); h.advance(60_000);
  const automatic = await h.alarm(); await h.finish(automatic.downloadId);
  const archiveId = h.values[LOCAL_BACKUP_KEY].archiveId;
  for (let index = 0; index < 2; index++) {
    const manual = await h.engine.runNow(); await h.finish(manual.downloadId);
    const call = h.downloadCalls.at(-1);
    assert.equal(call.conflictAction, 'uniquify');
    assert.ok(!call.filename.includes('auto-'));
    assert.ok(!call.filename.includes(archiveId));
  }
  assert.equal(h.values[LOCAL_BACKUP_KEY].autoSlots['soap628/2026-09-26'], 'A');
  assert.equal(new Set(h.downloadCalls.map(call => call.filename)).size, 3);
});

test('recovery cannot mistake an old rotated file for a new interrupted attempt without a stored ID', async () => {
  const h = setup(); await h.engine.start();
  for (let index = 0; index < 2; index++) {
    h.advance(60_000); h.state.settings.posts++;
    await h.engine.changed(h.state); const active = await h.alarm(); await h.finish(active.downloadId);
  }
  h.advance(60_000); h.state.settings.posts++;
  await h.engine.changed(h.state); const active = await h.alarm();
  h.values[LOCAL_BACKUP_KEY].downloadId = null;
  h.records.delete(active.downloadId);
  const restored = await h.restart().start();
  assert.equal(restored.status, 'error');
  assert.equal(restored.dirty, true);
  assert.notEqual(restored.currentSignature, restored.lastCompletedSignature);
});

test('timed-out rotation cancels and verifies the old download before reusing its slot', async () => {
  const h = setup(); await h.engine.start(); h.advance(60_000);
  const first = await h.alarm();
  const firstName = h.downloadCalls[0].filename;
  h.state.settings.posts++;
  await h.engine.changed(h.state); h.advance(900_000);
  const canceled = await h.alarm(BACKUP_SAFETY_ALARM);
  assert.deepEqual(h.canceled, [first.downloadId]);
  assert.equal(h.records.get(first.downloadId).state, 'interrupted');
  assert.equal(canceled.status, 'error');
  h.advance(300_000);
  const next = await h.alarm();
  assert.notEqual(next.downloadId, first.downloadId);
  assert.equal(h.downloadCalls[1].filename, firstName);
  await h.finish(first.downloadId);
  assert.equal((await h.engine.status()).downloadId, next.downloadId, 'late old events cannot complete the new snapshot');
  assert.equal((await h.engine.status()).lastCompletedSignature, null);
});

test('cancel failure keeps the rotating slot reserved until the original download actually completes', async () => {
  const h = setup(); await h.engine.start(); h.advance(60_000);
  const original = await h.alarm();
  h.chrome.downloads.cancel = async () => { throw new Error('Cancellation temporarily unavailable'); };
  h.state.settings.posts++; await h.engine.changed(h.state); h.advance(900_000);
  const blocked = await h.alarm(BACKUP_SAFETY_ALARM);
  assert.equal(blocked.status, 'error');
  assert.equal(blocked.downloadId, original.downloadId);
  assert.equal(blocked.inFlightSignature, original.inFlightSignature);
  assert.notEqual(blocked.currentSignature, blocked.inFlightSignature);
  h.advance(300_000); await h.alarm();
  await h.engine.runNow();
  assert.equal(h.downloadCalls.length, 1, 'automatic and manual retries cannot create overlapping writers');
  const completed = await h.finish(original.downloadId);
  assert.equal(completed.dirty, true);
  h.advance(60_000); const next = await h.alarm();
  assert.ok(next.downloadId);
  assert.match(h.downloadCalls[0].filename, /auto-A/);
  assert.match(h.downloadCalls[1].filename, /auto-B/, 'a late completion advances the slot before the next write');
});

test('cancel acknowledgement is insufficient while a follow-up search still reports the download running', async () => {
  const h = setup(); const first = await h.engine.runNow();
  h.chrome.downloads.cancel = async () => {};
  h.advance(900_000); const result = await h.alarm(BACKUP_SAFETY_ALARM);
  assert.equal(result.status, 'error');
  assert.equal(result.downloadId, first.downloadId);
  h.advance(300_000); await h.alarm();
  assert.equal(h.downloadCalls.length, 1);
});

test('unknown-ID recovery search failure retains its pending file instead of overwriting an unconfirmed download', async () => {
  const h = setup(); await h.engine.start(); h.advance(60_000);
  const first = await h.alarm();
  const storedName = h.values[LOCAL_BACKUP_KEY].pendingFilename;
  h.values[LOCAL_BACKUP_KEY].downloadId = null;
  const search = h.chrome.downloads.search;
  h.chrome.downloads.search = async () => { throw new Error('Download database busy'); };
  const result = await h.restart().start();
  assert.equal(result.status, 'error');
  assert.equal(result.downloadId, null);
  assert.equal(result.inFlightSignature, first.inFlightSignature);
  assert.equal(h.values[LOCAL_BACKUP_KEY].pendingFilename, storedName);
  h.advance(300_000); await h.alarm();
  assert.equal(h.downloadCalls.length, 1);
  h.chrome.downloads.search = search;
  h.records.get(first.downloadId).state = 'complete';
  const recovered = await h.alarm();
  assert.equal(recovered.status, 'saved');
  assert.equal(recovered.lastCompletedDownloadId, first.downloadId);
});

test('known-ID recovery query failure requires confirmed cancellation before releasing the active slot', async () => {
  const h = setup(); const first = await h.engine.runNow();
  const search = h.chrome.downloads.search;
  h.chrome.downloads.search = async () => { throw new Error('Download search unavailable'); };
  const result = await h.alarm(BACKUP_SAFETY_ALARM);
  assert.equal(result.status, 'error');
  assert.equal(result.downloadId, first.downloadId);
  assert.equal(result.inFlightSignature, first.inFlightSignature);
  assert.deepEqual(h.canceled, [first.downloadId]);
  assert.equal(h.downloadCalls.length, 1);
  h.chrome.downloads.search = search;
  const confirmed = await h.alarm();
  assert.equal(confirmed.downloadId, null);
  assert.equal(confirmed.status, 'error');
});

test('Analytics-only and verification-only accounts qualify for backup protection', async () => {
  for (const kind of ['analytics', 'verification']) {
    const state = newState();
    if (kind === 'analytics') state.analyticsSummary = { period: { label: '7D', days: 7, start: null, end: null }, impressions: { value: 3, source: 'network', at: date.toISOString(), approximate: false } };
    else state.account.blueVerified = { value: false, source: 'network', at: date.toISOString() };
    const h = setup(state), running = await h.engine.runNow();
    assert.equal(running.status, 'saving');
    assert.ok(running.requestedSignature);
    assert.equal(h.downloadCalls.length, 1);
  }
});

test('a metadata write failure after obtaining a download ID cancels that writer before permitting retry', async () => {
  const h = setup(); await h.engine.start();
  const set = h.chrome.storage.local.set;
  let failed = false;
  h.chrome.storage.local.set = async value => {
    if (!failed && value[LOCAL_BACKUP_KEY]?.downloadId !== null) { failed = true; throw new Error('Metadata write failed'); }
    return set(value);
  };
  const result = await h.engine.runNow();
  assert.equal(result.status, 'error');
  assert.equal(result.downloadId, null);
  assert.deepEqual(h.canceled, [1]);
  assert.equal(h.records.get(1).state, 'interrupted');
  assert.equal(h.downloadCalls.length, 1);
  assert.match(result.error, /Metadata write failed/);
});

test('zero tracked views alone remain valid records for restore protection', async () => {
  const state = newState();
  state.days['2026-09-26'] = { posts: 0, replies: 0, trackedViews: 0 };
  const h = setup(state), running = await h.engine.runNow();
  assert.equal(running.status, 'saving');
  assert.ok(running.requestedSignature);
  assert.equal(h.downloadCalls.length, 1);
});

test('disabled automatic backups still show and maintain a manual download until completion', async () => {
  const h = setup(); await h.engine.setEnabled(false);
  assert.equal(h.alarms.has(BACKUP_SAFETY_ALARM), false);
  const running = await h.engine.runNow();
  assert.equal(running.enabled, false); assert.equal(running.status, 'saving');
  assert.deepEqual(h.alarms.get(BACKUP_SAFETY_ALARM), { periodInMinutes: 5 });
  h.state.settings.posts++; await h.engine.changed(h.state);
  h.records.get(running.downloadId).state = 'complete';
  const finished = await h.alarm(BACKUP_SAFETY_ALARM);
  assert.equal(finished.status, 'disabled');
  assert.equal(finished.lastCompletedDownloadId, running.downloadId);
  assert.equal(finished.dirty, true);
  assert.equal(h.alarms.has(BACKUP_SAFETY_ALARM), false);
  assert.equal(h.downloadCalls.length, 1, 'finishing a manual snapshot does not start an automatic one');
});

test('a disabled worker restores maintenance for its pending download and exposes failure status', async () => {
  const h = setup(); const running = await h.engine.runNow();
  await h.engine.setEnabled(false);
  h.alarms.clear();
  const restored = await h.restart().start();
  assert.equal(restored.status, 'saving');
  assert.equal(restored.downloadId, running.downloadId);
  assert.ok(h.alarms.has(BACKUP_SAFETY_ALARM));
  const failed = await h.finish(running.downloadId, 'interrupted', 'FILE_FAILED');
  assert.equal(failed.status, 'error'); assert.equal(failed.enabled, false);
  assert.equal(h.alarms.has(BACKUP_SAFETY_ALARM), false);
  h.advance(300_000); await h.alarm(BACKUP_SAFETY_ALARM);
  assert.equal(h.downloadCalls.length, 1);
});
