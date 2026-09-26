// File snapshots live in Downloads, outside extension storage, and survive uninstall.
// Only metadata is stored here. The JSON payload always uses the existing import format.
import { dayKey } from './core.js';
export const LOCAL_BACKUP_KEY = 'xFocusLocalBackupV1';
export const BACKUP_ALARM = 'xFocusLocalBackupPending';
export const BACKUP_SAFETY_ALARM = 'xFocusLocalBackupSafety';
const MINUTE = 60_000;
const RETRY = 5 * MINUTE;
const STALLED_AFTER = 15 * MINUTE;
export const MAX_BACKUP_BYTES = 16 * 1024 * 1024;
const randomHex = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(6)), byte => byte.toString(16).padStart(2, '0')).join('');
const initialMeta = () => ({ version: 1, enabled: true, archiveId: randomHex(), autoSlots: {}, pendingAutoKey: null, pendingAutoSlot: null, currentSignature: null, savedSignature: null, pendingSignature: null, downloadId: null, pendingFilename: null, lastDownloadId: null, filename: null, lastSuccessAt: null, lastAttemptAt: null, dirtySince: null, nextRunAt: null, error: null });

function hasData(state) {
  if (!state || typeof state !== 'object') return false;
  if (Object.keys(state.posts || {}).length || state.rewards?.earned?.length) return true;
  if (state.analyticsSummary != null || state.account?.blueVerified != null) return true;
  return Object.values(state.days || {}).some(day => day.posts || day.replies || day.note || day.followers || day.verifiedFollowers || day.impressions || day.trackedViews != null || day.loggedPostIds?.length);
}

function businessValue(value) {
  if (Array.isArray(value)) return value.map(businessValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => !['lastCapture', 'lastNetworkAt', 'lastPublishAt', 'lastPageAt', 'at', 'observedAt'].includes(key)).map(key => [key, businessValue(value[key])]));
}

export const backupComparableState = state => JSON.stringify(businessValue(state));

async function signature(state) {
  const bytes = new TextEncoder().encode(backupComparableState(state));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function accountDirectory(state) {
  let username = String(state.settings?.username || 'local').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'local';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(username)) username = `_${username}`;
  return username;
}

function snapshotName(state, date) {
  const username = accountDirectory(state);
  const timestamp = date.toISOString().replace(/[:.]/g, '-');
  return `X-Focus/${username}/x-focus-${timestamp}-${randomHex()}.json`;
}

export function createLocalBackup({ chrome, getState, now = () => new Date() }) {
  const available = Boolean(chrome?.downloads?.download && chrome?.downloads?.search && chrome?.downloads?.onChanged?.addListener && chrome?.alarms?.create && chrome?.alarms?.clear && chrome?.alarms?.onAlarm?.addListener && chrome?.storage?.local?.get && chrome?.storage?.local?.set);
  let meta = initialMeta(), initialized = false, safetyActive = null, queue = Promise.resolve();
  const time = () => now().getTime();
  const iso = () => now().toISOString();
  const dirty = () => Boolean(meta.currentSignature && meta.currentSignature !== meta.savedSignature);
  const report = () => ({ available, enabled: meta.enabled, status: !available ? 'unavailable' : meta.error ? 'error' : meta.pendingSignature ? 'saving' : !meta.enabled ? 'disabled' : dirty() ? 'pending' : meta.lastSuccessAt ? 'saved' : 'idle', lastSuccessAt: meta.lastSuccessAt, filename: meta.filename, error: meta.error, dirty: dirty(), downloadId: meta.downloadId, lastCompletedDownloadId: meta.lastDownloadId, nextRunAt: meta.nextRunAt, currentSignature: meta.currentSignature, inFlightSignature: meta.pendingSignature, lastCompletedSignature: meta.savedSignature });
  const serial = task => { const result = queue.then(task); queue = result.catch(() => {}); return result; };
  const persist = () => chrome.storage.local.set({ [LOCAL_BACKUP_KEY]: { ...meta } });
  const clearPending = () => { meta.pendingSignature = null; meta.downloadId = null; meta.pendingFilename = null; meta.pendingAutoKey = null; meta.pendingAutoSlot = null; };

  async function maintainSafetyAlarm() {
    const needed = Boolean(meta.enabled || meta.pendingSignature);
    if (safetyActive === needed) return;
    if (needed) await chrome.alarms.create(BACKUP_SAFETY_ALARM, { periodInMinutes: 5 });
    else await chrome.alarms.clear(BACKUP_SAFETY_ALARM);
    safetyActive = needed;
  }

  async function schedule() {
    await maintainSafetyAlarm();
    if (!meta.enabled || !dirty() || meta.pendingSignature) {
      meta.nextRunAt = null;
      await chrome.alarms.clear(BACKUP_ALARM);
      return;
    }
    const earliest = meta.error && meta.lastAttemptAt ? Date.parse(meta.lastAttemptAt) + RETRY : 0;
    const target = Math.max(time() + 1_000, earliest, (meta.dirtySince || time()) + MINUTE);
    meta.nextRunAt = new Date(target).toISOString();
    await chrome.alarms.create(BACKUP_ALARM, { when: target });
  }

  async function observe(state) {
    const nextSignature = hasData(state) ? await signature(state) : null;
    if (nextSignature === meta.currentSignature) return;
    meta.currentSignature = nextSignature;
    if (dirty()) meta.dirtySince ??= time();
    else { meta.dirtySince = null; if (!meta.pendingSignature) meta.error = null; }
    await schedule();
    await persist();
  }

  async function fail(reason) {
    clearPending();
    meta.error = String(reason || 'The backup download did not finish.').slice(0, 240);
    // A stalled/interrupted download starts a fresh retry cooldown when detected.
    meta.lastAttemptAt = iso();
    meta.dirtySince ??= time();
    await schedule();
    await persist();
  }

  async function hold(reason) {
    // Unknown download state must retain ownership of its rotating file slot.
    meta.error = String(reason || 'The backup download status could not be confirmed.').slice(0, 240);
    await persist();
  }

  async function complete(item) {
    if (!meta.pendingSignature || (meta.downloadId !== null && item.id !== meta.downloadId)) return;
    meta.savedSignature = meta.pendingSignature;
    meta.lastDownloadId = item.id ?? meta.downloadId;
    meta.filename = meta.pendingFilename;
    meta.lastSuccessAt = iso();
    meta.error = null;
    if (meta.pendingAutoKey && meta.pendingAutoSlot) meta.autoSlots[meta.pendingAutoKey] = meta.pendingAutoSlot;
    clearPending();
    if (!dirty()) meta.dirtySince = null;
    await schedule();
    await persist();
  }

  async function recover() {
    if (!meta.pendingSignature) return;
    let results;
    try {
      results = await chrome.downloads.search(meta.downloadId === null ? { query: [meta.pendingFilename], startedAfter: meta.lastAttemptAt, limit: 10, orderBy: ['-startTime'] } : { id: meta.downloadId });
    } catch (error) {
      return meta.downloadId === null ? hold(error?.message || error) : cancelAndConfirm(error?.message || error);
    }
    const item = meta.downloadId === null ? results.find(candidate => Date.parse(candidate.startTime) >= Date.parse(meta.lastAttemptAt) && (candidate.filename?.replaceAll('\\', '/').endsWith(`/${meta.pendingFilename}`) || candidate.filename === meta.pendingFilename)) : results.find(candidate => candidate.id === meta.downloadId);
    if (!item) return meta.downloadId === null ? fail('The pending backup download could not be found.') : cancelAndConfirm('The pending backup download could not be found.');
    meta.downloadId = item.id;
    if (item.state === 'complete') return complete(item);
    if (item.state === 'interrupted') return fail(item.error || 'The backup download was interrupted.');
    if (meta.lastAttemptAt && time() - Date.parse(meta.lastAttemptAt) >= STALLED_AFTER) return cancelAndConfirm('The backup download has not finished after 15 minutes.');
    meta.error = null;
    await persist();
  }

  async function cancelAndConfirm(reason) {
    if (meta.downloadId === null || !chrome.downloads.cancel) return hold(reason);
    let cancelError;
    try { await chrome.downloads.cancel(meta.downloadId); }
    catch (error) { cancelError = error; }
    let results;
    try { results = await chrome.downloads.search({ id: meta.downloadId }); }
    catch (error) { return hold(error?.message || error); }
    const item = results.find(candidate => candidate.id === meta.downloadId);
    if (item?.state === 'complete') return complete(item);
    if (item?.state === 'interrupted' || (!item && !cancelError)) return fail(reason);
    return hold(cancelError?.message || reason);
  }

  async function initialize() {
    if (initialized) return;
    if (!available) { initialized = true; return; }
    const stored = (await chrome.storage.local.get(LOCAL_BACKUP_KEY))[LOCAL_BACKUP_KEY];
    meta = initialMeta();
    if (stored?.version === 1) {
      for (const key of Object.keys(meta)) if (Object.hasOwn(stored, key)) meta[key] = stored[key];
      meta.enabled = stored.enabled !== false;
    }
    await maintainSafetyAlarm();
    await observe(await getState());
    await recover();
    await schedule();
    await persist();
    initialized = true;
  }

  async function save(manual = false) {
    const state = await getState();
    await observe(state);
    const requestedSignature = meta.currentSignature;
    const result = () => ({ ...report(), requestedSignature });
    if (!hasData(state) || meta.pendingSignature || (!manual && (!meta.enabled || !dirty()))) return result();
    if (!manual && meta.error && time() < Date.parse(meta.lastAttemptAt) + RETRY) { await schedule(); await persist(); return result(); }
    meta.pendingSignature = await signature(state);
    if (manual) meta.pendingFilename = snapshotName(state, now());
    else {
      const username = accountDirectory(state), date = dayKey(now(), state.settings?.timeZone);
      meta.pendingAutoKey = `${username}/${date}`;
      meta.pendingAutoSlot = meta.autoSlots[meta.pendingAutoKey] === 'A' ? 'B' : 'A';
      meta.pendingFilename = `X-Focus/${username}/x-focus-${date}-${meta.archiveId}-auto-${meta.pendingAutoSlot}.json`;
    }
    meta.downloadId = null;
    meta.lastAttemptAt = iso();
    meta.error = null;
    meta.nextRunAt = null;
    await chrome.alarms.clear(BACKUP_ALARM);
    await maintainSafetyAlarm();
    await persist();
    let url;
    try {
      const json = JSON.stringify(state, null, 2);
      if (new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES) throw new Error('Backup size exceeds the 16 MiB restore limit.');
      url = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
      const id = await chrome.downloads.download({ url, filename: meta.pendingFilename, saveAs: false, conflictAction: manual ? 'uniquify' : 'overwrite' });
      if (!Number.isInteger(id)) throw new Error('The browser did not return a download ID.');
      meta.downloadId = id;
      await persist();
      // Complete events may have occurred before the service worker stored the ID.
      await recover();
    } catch (error) {
      if (meta.downloadId !== null) await cancelAndConfirm(error?.message || error);
      else await fail(error?.message || error);
    }
    finally { url = null; }
    return result();
  }

  if (available) {
    chrome.downloads.onChanged.addListener(delta => {
      if (!delta?.state && !delta?.error) return;
      void serial(async () => {
        await initialize();
        if (delta.id !== meta.downloadId || !meta.pendingSignature) return;
        if (delta.state?.current === 'complete') await complete({ id: delta.id });
        else if (delta.state?.current === 'interrupted') await fail(delta.error?.current || 'The backup download was interrupted.');
        else if (delta.error?.current) await cancelAndConfirm(delta.error.current);
      }).catch(() => {});
    });
    chrome.alarms.onAlarm.addListener(alarm => {
      if (![BACKUP_ALARM, BACKUP_SAFETY_ALARM].includes(alarm?.name)) return;
      void serial(async () => {
        await initialize();
        await recover();
        if (meta.enabled) await save();
      }).catch(() => {});
    });
  }

  return {
    start: () => serial(async () => { await initialize(); return report(); }),
    changed: state => serial(async () => { await initialize(); if (available) await observe(state); return report(); }),
    runNow: () => serial(async () => { await initialize(); if (!available) return report(); await recover(); return save(true); }),
    status: () => serial(async () => { await initialize(); return report(); }),
    setEnabled: enabled => serial(async () => {
      await initialize();
      if (typeof enabled !== 'boolean') throw new Error('The backup setting must be a boolean.');
      meta.enabled = enabled;
      if (available) {
        await observe(await getState());
        await schedule();
        await persist();
      }
      return report();
    }),
    showFile: () => serial(async () => { await initialize(); if (available && meta.lastDownloadId !== null && chrome.downloads.show) await chrome.downloads.show(meta.lastDownloadId); return report(); }),
  };
}
