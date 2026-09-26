import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import * as core from '../core.js';
import * as i18n from '../options-i18n.js';
import * as assessment from '../assessment.js';
import { backupComparableState } from '../local-backup.js';

const html = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/^import .+;\r?\n/gm, '');
const flush = () => new Promise(resolve => setImmediate(resolve));
const hasChinese = /[\u3400-\u9fff]/;

function uiStrings(document) {
  const copy = document.body.cloneNode(true);
  copy.querySelectorAll('option,script,style').forEach(node => node.remove());
  copy.querySelectorAll('textarea').forEach(node => { node.textContent = ''; });
  return [copy.textContent, ...Array.from(copy.querySelectorAll('[aria-label],[placeholder],[title]')).flatMap(node => ['aria-label', 'placeholder', 'title'].map(name => node.getAttribute(name) || ''))];
}

async function loadOptions(language = 'en', filled = false, options = {}) {
  const { document, window } = parseHTML(html);
  for (const form of document.querySelectorAll('form')) Object.defineProperty(form, 'elements', { get: () => Object.fromEntries(Array.from(form.querySelectorAll('[name]')).map(node => [node.name, node])) });
  for (const dialog of document.querySelectorAll('dialog')) { dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; }; }
  const select = document.querySelector('#language-select');
  let selected = 'zh-CN'; Object.defineProperty(select, 'value', { get: () => selected, set: value => { selected = value; } });
  let stored = core.newState(); stored.settings.language = language; stored.settings.username = 'soap628';
  if (filled) {
    const date = core.dayKey(), day = core.ensureDay(stored, date);
    Object.assign(day, { posts: 1, replies: 4, auto: { posts: 1, replies: 4 }, trackedViews: 15, trackedIds: ['123'] });
    day.followers = { value: 1200, approximate: true, at: new Date().toISOString(), source: 'network' };
    day.impressions = { value: 9200, approximate: false, at: new Date().toISOString(), source: 'analytics' };
    stored.posts['123'] = { id: '123', text: '<img src=x onerror=alert(1)> safe text', views: 12345, approximate: true, observedAt: new Date().toISOString() };
    stored.tracking.lastPageAt = new Date().toISOString(); stored.tracking.lastNetworkAt = new Date().toISOString();
  }
  const actions = []; let changed, rejectNext, backupState = { enabled: true, status: 'idle', lastSuccessAt: null, filename: null, error: null };
  let backupResponse;
  const chrome = {
    runtime: { id: 'options-test', async sendMessage(action) {
      actions.push(action);
      if (rejectNext) { const error = rejectNext; rejectNext = null; return { ok: false, error }; }
      if (action.type.startsWith('backup-')) {
        if (action.type === 'backup-setting') backupState = { ...backupState, enabled: action.enabled, status: action.enabled ? 'idle' : 'disabled' };
        if (action.type === 'backup-now') backupState = backupResponse || { ...backupState, status: 'saving', downloadId: 1, requestedSignature: 'snapshot-1', inFlightSignature: 'snapshot-1' };
        return { ok: true, backup: structuredClone(backupState) };
      }
      if (action.type !== 'get') stored = core.reduce(stored, action);
      return { ok: true, state: structuredClone(stored) };
    } },
    storage: { onChanged: { addListener(listener) { changed = listener; } } },
    tabs: { create() {}, query: async () => [], sendMessage: async () => ({}) }
  };
  if (options.noStorageEvents) delete chrome.storage;
  if (options.demo) delete chrome.runtime.id;
  let scrolled = false;
  document.querySelector('#local-backup').scrollIntoView = () => { scrolled = true; };
  const context = vm.createContext({ ...core, ...i18n, ...assessment, backupComparableState, document, window, chrome, location: { search: options.demo ? '?demo=1' : '', hash: options.hash || '' }, URLSearchParams, URL, Blob, console, setTimeout: () => 0, clearTimeout() {}, setInterval() {}, structuredClone });
  await vm.runInContext(`(async () => { ${app}\n })()`, context);
  return { document, window, actions, get stored() { return stored; }, get scrolled() { return scrolled; }, fail(message) { rejectNext = message; },
    nextBackup(value) { backupResponse = value; },
    updateBackup(patch) { backupState = { ...backupState, ...patch }; changed?.({ xFocusLocalBackupV1: { newValue: structuredClone(backupState) } }); },
    changeState(action) { stored = core.reduce(stored, action); changed?.({ [core.STORAGE_KEY]: { newValue: structuredClone(stored) } }); },
    heartbeat() { stored.tracking.lastPageAt = new Date().toISOString(); stored.lastCapture = new Date().toISOString(); for (const post of Object.values(stored.posts)) post.observedAt = new Date().toISOString(); changed?.({ [core.STORAGE_KEY]: { newValue: structuredClone(stored) } }); },
    update(language) { stored.settings.language = language; changed?.({ [core.STORAGE_KEY]: { newValue: structuredClone(stored) } }); }
  };
}

test('static options copy and accessibility attributes switch languages without replacing user inputs', () => {
  const { document } = parseHTML(html), localize = i18n.createOptionsLocalizer(document);
  const username = document.querySelector('[name="username"]'), note = document.querySelector('textarea');
  username.value = 'unsaved_handle'; note.value = '用户自己的草稿';
  localize('en');
  assert.equal(document.documentElement.lang, 'en'); assert.equal(document.title, 'X Focus · Daily progress');
  assert.ok(uiStrings(document).every(value => !hasChinese.test(value)), 'all static UI strings are translated');
  assert.equal(document.querySelector('[name="username"]'), username);
  assert.equal(username.value, 'unsaved_handle'); assert.equal(note.value, '用户自己的草稿');
  assert.equal(note.getAttribute('placeholder'), 'What should you continue or change tomorrow?');
  localize('zh-CN');
  assert.equal(document.querySelector('#settings-button').getAttribute('aria-label'), '设置账号与目标');
  assert.equal(username.value, 'unsaved_handle'); assert.equal(note.value, '用户自己的草稿');
});

test('persisted English renders the full empty dashboard, forms, charts and record states in English', async () => {
  const { document } = await loadOptions();
  assert.ok(uiStrings(document).every(value => !hasChinese.test(value)), uiStrings(document).filter(value => hasChinese.test(value)).join('\n'));
  assert.match(document.querySelector('#followers-chart').textContent, /No Followers readings yet/);
  assert.equal(document.querySelector('#language-select').value, 'en');
  assert.equal(document.querySelector('#account-label').textContent, '@soap628 · Daily progress');
});

test('populated English dashboard translates chart tooltips and posts without injecting post content', async () => {
  const { document } = await loadOptions('en', true);
  assert.ok(uiStrings(document).every(value => !hasChinese.test(value)), uiStrings(document).filter(value => hasChinese.test(value)).join('\n'));
  assert.match(document.querySelector('#captured-posts').textContent, /12,345 lifetime views/);
  assert.equal(document.querySelector('#captured-posts img'), null);
  assert.match(document.querySelector('#tracked-views-chart title').textContent, /Tracked view increases/);
  assert.match(document.querySelector('#capture-status').textContent, /Last X data/);
});

test('language change persists separately and external language updates preserve open form drafts', async () => {
  const env = await loadOptions('zh-CN'), { document, window } = env;
  document.querySelector('#settings-button').click();
  const username = document.querySelector('[name="username"]'), posts = document.querySelector('#settings-form [name="posts"]');
  username.value = 'draft_handle'; posts.value = '17';
  const select = document.querySelector('#language-select'); select.value = 'en'; select.dispatchEvent(new window.Event('change'));
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(env.actions.at(-1))), { type: 'language', language: 'en' });
  assert.equal(env.stored.settings.language, 'en');
  assert.equal(document.querySelector('#settings-dialog').open, true);
  assert.equal(username.value, 'draft_handle'); assert.equal(posts.value, '17');
  assert.equal(document.querySelector('#toast').textContent, 'Language saved');
  env.update('zh-CN');
  assert.equal(document.documentElement.lang, 'zh-CN'); assert.equal(username.value, 'draft_handle');
});

test('English UI maps known save errors and never exposes unknown Chinese backend text', async () => {
  const env = await loadOptions(), { document, window } = env;
  document.querySelector('#settings-button').click();
  env.fail('每日目标须为 0–1000 的整数');
  document.querySelector('#settings-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await flush();
  assert.equal(document.querySelector('#settings-error').textContent, 'Daily goals must be whole numbers from 0 to 1000.');
  env.fail('未知错误：包含私人内容');
  document.querySelector('#settings-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await flush();
  assert.equal(document.querySelector('#settings-error').textContent, 'Something went wrong. Please try again.');
  assert.equal(i18n.optionsError('en', new SyntaxError('bad json')), 'The backup file is not valid JSON.');
});

test('English CSV changes only the header and preserves escaped data including user-written notes', () => {
  const state = core.newState(), day = core.ensureDay(state, core.dayKey());
  day.note = '=SUM(A1:A2)\n保留这句复盘';
  const original = core.csv(state), translated = i18n.optionsCsv(original, 'en');
  assert.match(translated, /^\uFEFF"Date","Posts","Post goal"/);
  assert.equal(translated.slice(translated.indexOf('\r\n')), original.slice(original.indexOf('\r\n')));
  assert.equal(i18n.optionsCsv(original, 'zh-CN'), original);
});

test('native form validation can use the chosen interface language instead of the browser language', () => {
  assert.equal(i18n.optionsValidationError('en', { validity: { valueMissing: true } }), 'Please fill out this field.');
  assert.equal(i18n.optionsValidationError('en', { validity: { rangeOverflow: true }, max: '1000' }), 'The value must be no more than 1000.');
  assert.equal(i18n.optionsValidationError('en', { validity: { patternMismatch: true }, name: 'username' }), 'Enter a valid X handle, not a URL.');
  assert.equal(i18n.optionsValidationError('zh-CN', { validity: { stepMismatch: true } }), '请输入整数。');
});

async function selectBackup(env, data, size = 1000) {
  const input = env.document.querySelector('#import-file');
  Object.defineProperty(input, 'files', { configurable: true, value: [{ size, text: async () => JSON.stringify(data) }] });
  input.dispatchEvent(new env.window.Event('change')); await flush();
}
function restoreFixture() {
  const value = core.newState(); value.settings.username = 'another_account';
  const day = core.ensureDay(value, '2026-01-01'); day.posts = 3; day.replies = 7;
  return value;
}

test('local backup card distinguishes queued, saving and completed files without changing action records', async () => {
  const env = await loadOptions('en', true), { document } = env, before = JSON.stringify(env.stored);
  assert.equal(document.querySelector('#local-backup').hidden, false);
  assert.match(document.querySelector('#backup-status').textContent, /Automatic file backups on/);
  assert.match(document.querySelector('#backup-time').textContent, /No completed file/);
  document.querySelector('#backup-now').click(); await flush();
  assert.equal(env.actions.at(-1).type, 'backup-now');
  assert.equal(JSON.stringify(env.stored), before);
  assert.match(document.querySelector('#backup-status').textContent, /Completion not yet confirmed/);
  assert.equal(document.querySelector('#backup-show').disabled, true);
  env.updateBackup({ status: 'pending', inFlightSignature: null }); await flush();
  assert.equal(document.querySelector('#backup-status').textContent, 'Local records saved · Waiting for the next file backup');
  env.updateBackup({ status: 'saved', lastSuccessAt: '2026-09-26T02:34:00Z', filename: 'X-Focus/soap628/session-1.json' }); await flush();
  assert.equal(document.querySelector('#backup-status').textContent, 'File saved to computer');
  assert.match(document.querySelector('#backup-time').textContent, /10:34/);
  assert.equal(document.querySelector('#backup-path').textContent, 'X-Focus/soap628/session-1.json');
  assert.equal(document.querySelector('#backup-show').disabled, false);
});

test('backup settings and save failures remain separate from the normal tracking reducer', async () => {
  const env = await loadOptions('en', true), { document, window } = env;
  const checkbox = document.querySelector('#backup-enabled'); checkbox.checked = false;
  checkbox.dispatchEvent(new window.Event('change')); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(env.actions.at(-1))), { type: 'backup-setting', enabled: false });
  assert.match(document.querySelector('#backup-status').textContent, /Automatic file backups off/);
  env.fail('无法保存'); document.querySelector('#backup-now').click(); await flush();
  assert.match(document.querySelector('#backup-error').textContent, /Could not save/);
  document.querySelector('[data-adjust="posts:1"]').click(); await flush();
  assert.equal(env.stored.days[core.dayKey()].posts, 2);
});

test('file backup scheduling copy distinguishes immediate local records from daily downloads', async () => {
  const env = await loadOptions('en', true), { document, window } = env;
  const panel = document.querySelector('#local-backup');
  assert.match(panel.textContent, /saved to the local extension as they are recorded/);
  assert.match(panel.textContent, /appear in the Edge downloads list/);
  assert.match(panel.textContent, /at most once every 24 hours/);
  assert.match(panel.textContent, /without frequent retries after failures/);
  assert.equal(document.querySelector('#backup-next').textContent, 'Not scheduled yet');
  const start = env.actions.length;
  env.updateBackup({ status: 'pending', nextRunAt: '2026-09-28T02:34:00Z' }); await flush();
  assert.equal(document.querySelector('#backup-status').textContent, 'Local records saved · Waiting for the next file backup');
  assert.equal(document.querySelector('#backup-next-row').hidden, false);
  assert.match(document.querySelector('#backup-next').textContent, /10:34/);
  assert.equal(env.actions.slice(start).every(action => action.type === 'backup-status'), true, 'showing a schedule never starts a download');
  env.updateBackup({ status: 'error', error: '无法保存' }); await flush();
  assert.equal(document.querySelector('#backup-status').textContent, 'File backup failed · Local records saved; retry manually');
  assert.equal(document.querySelector('#backup-now').disabled, false);
  const checkbox = document.querySelector('#backup-enabled'); checkbox.checked = false;
  checkbox.dispatchEvent(new window.Event('change')); await flush();
  assert.equal(document.querySelector('#backup-next-row').hidden, true);
  env.update('zh-CN');
  assert.match(panel.textContent, /自动文件备份/);
  assert.match(panel.textContent, /最多每 24 小时下载一次/);
  assert.equal(document.querySelector('#backup-status').textContent, '自动文件备份已关闭 · 本机记录仍实时保存');
});

test('backup hash opens the today page and missing storage event APIs do not break the dashboard', async () => {
  const env = await loadOptions('en', false, { hash: '#backup', noStorageEvents: true });
  assert.equal(env.scrolled, true); assert.equal(env.document.querySelector('#today-page').hidden, false);
  assert.equal(env.document.querySelector('#growth-page').hidden, true);
  assert.equal(env.document.querySelector('#backup-now').disabled, false);
});

test('manual saves report completion while automatic backups remain disabled', async () => {
  const env = await loadOptions('en', true), { document, window } = env;
  const checkbox = document.querySelector('#backup-enabled'); checkbox.checked = false;
  checkbox.dispatchEvent(new window.Event('change')); await flush();
  document.querySelector('#backup-now').click(); await flush();
  assert.match(document.querySelector('#backup-status').textContent, /Completion not yet confirmed/);
  assert.equal(checkbox.checked, false);
  const completed = { enabled: false, status: 'disabled', dirty: false, inFlightSignature: null, currentSignature: 'snapshot-1', lastCompletedSignature: 'snapshot-1', requestedSignature: 'snapshot-1', lastSuccessAt: '2026-09-26T02:34:00Z' };
  env.updateBackup(completed); await flush();
  assert.equal(document.querySelector('#backup-status').textContent, 'File saved to computer · Automatic file backups off');
  assert.equal(checkbox.checked, false);
  assert.equal(document.querySelector('#backup-now').disabled, false);
  env.nextBackup(completed); document.querySelector('#backup-now').click(); await flush();
  assert.equal(document.querySelector('#toast').textContent, 'File saved to computer');
  assert.equal(checkbox.checked, false);
  env.updateBackup({ dirty: true }); await flush();
  assert.equal(document.querySelector('#backup-status').textContent, 'Automatic file backups off · Local records still save immediately');
  env.nextBackup({ ...completed, currentSignature: 'new-snapshot', requestedSignature: 'new-snapshot', dirty: true });
  document.querySelector('#backup-now').click(); await flush();
  assert.match(document.querySelector('#toast').textContent, /Save requested/);
  assert.equal(checkbox.checked, false);
  env.updateBackup(completed); await flush(); env.update('zh-CN');
  assert.equal(document.querySelector('#backup-status').textContent, '文件已写入电脑 · 自动文件备份已关闭');
});

test('demo does not pretend that files were written to the computer', async () => {
  const env = await loadOptions('en', false, { demo: true }), { document } = env;
  assert.match(document.querySelector('#backup-status').textContent, /预览中无法自动保存电脑文件/);
  assert.equal(document.querySelector('#backup-now').disabled, true);
  assert.equal(document.querySelector('#backup-enabled').disabled, true);
  assert.equal(env.actions.length, 0);
});

test('fresh installs preview action EXP and account differences and restore without backing up empty data', async () => {
  const env = await loadOptions(), { document } = env;
  await selectBackup(env, restoreFixture(), 6 * 1024 * 1024);
  const summary = document.querySelector('#import-summary').textContent;
  assert.match(summary, /@another_account/); assert.match(summary, /Total posts3/); assert.match(summary, /Total replies7/); assert.match(summary, /22 EXP/); assert.match(summary, /Collectibles found0/);
  assert.match(document.querySelector('#import-guidance').textContent, /different account/);
  assert.equal(document.querySelector('#backup-before-import').hidden, true);
  assert.equal(document.querySelector('#confirm-import').disabled, false);
  document.querySelector('#confirm-import').click(); await flush();
  assert.equal(env.stored.settings.username, 'another_account');
  assert.equal(env.stored.days['2026-01-01'].posts, 3);
});

test('existing records require the corresponding file snapshot to complete before restoring', async () => {
  const env = await loadOptions('en', true), { document } = env;
  await selectBackup(env, restoreFixture());
  assert.equal(document.querySelector('#confirm-import').disabled, true);
  document.querySelector('#backup-before-import').click(); await flush();
  assert.equal(document.querySelector('#confirm-import').disabled, true);
  env.updateBackup({ lastSuccessAt: '2026-09-26T02:30:00Z', lastCompletedDownloadId: 77, lastCompletedSignature: 'old-snapshot' }); await flush();
  assert.equal(document.querySelector('#confirm-import').disabled, true, 'another completed download is insufficient');
  env.updateBackup({ status: 'saved', inFlightSignature: null, lastCompletedDownloadId: 1, lastCompletedSignature: 'snapshot-1' }); await flush();
  assert.equal(document.querySelector('#confirm-import').disabled, false);
  env.heartbeat();
  assert.equal(document.querySelector('#confirm-import').disabled, false, 'heartbeat timestamps do not invalidate the safety backup');
  env.changeState({ type: 'adjust', kind: 'replies', amount: 1 });
  assert.equal(document.querySelector('#confirm-import').disabled, true, 'new records need a new safety backup');
});

test('an older in-flight snapshot cannot authorize replacement and failed protection can be retried', async () => {
  const env = await loadOptions('en', true), { document } = env;
  await selectBackup(env, restoreFixture());
  env.nextBackup({ enabled: true, status: 'saving', downloadId: 7, requestedSignature: 'new-state', inFlightSignature: 'old-state', lastCompletedSignature: null });
  document.querySelector('#backup-before-import').click(); await flush();
  assert.match(document.querySelector('#import-error').textContent, /still waiting/);
  env.updateBackup({ status: 'saved', inFlightSignature: null, lastCompletedSignature: 'old-state' }); await flush();
  assert.equal(document.querySelector('#confirm-import').disabled, true);
  assert.equal(document.querySelector('#backup-before-import').disabled, false);
  env.nextBackup({ enabled: true, status: 'saving', downloadId: 8, requestedSignature: 'new-state', inFlightSignature: 'new-state' });
  document.querySelector('#backup-before-import').click(); await flush();
  env.updateBackup({ status: 'error', inFlightSignature: null, error: '无法保存' }); await flush();
  assert.equal(document.querySelector('#confirm-import').disabled, true);
  assert.equal(document.querySelector('#backup-before-import').disabled, false);
  assert.match(document.querySelector('#import-error').textContent, /Retry saving/);
});

test('restore rejects files above the supported 16 MiB boundary with translated feedback', async () => {
  const env = await loadOptions(); await selectBackup(env, restoreFixture(), 16 * 1024 * 1024 + 1);
  assert.match(env.document.querySelector('#toast').textContent, /no larger than 16 MB/);
  assert.notEqual(env.document.querySelector('#import-dialog').open, true);
});
