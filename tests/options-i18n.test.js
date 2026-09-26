import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import * as core from '../core.js';
import * as i18n from '../options-i18n.js';

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

async function loadOptions(language = 'en', filled = false) {
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
  const actions = []; let changed, rejectNext;
  const chrome = {
    runtime: { id: 'options-test', async sendMessage(action) {
      actions.push(action);
      if (rejectNext) { const error = rejectNext; rejectNext = null; return { ok: false, error }; }
      if (action.type !== 'get') stored = core.reduce(stored, action);
      return { ok: true, state: structuredClone(stored) };
    } },
    storage: { onChanged: { addListener(listener) { changed = listener; } } },
    tabs: { create() {}, query: async () => [], sendMessage: async () => ({}) }
  };
  const context = vm.createContext({ ...core, ...i18n, document, window, chrome, location: { search: '' }, URLSearchParams, URL, Blob, console, setTimeout: () => 0, clearTimeout() {}, setInterval() {}, structuredClone });
  await vm.runInContext(`(async () => { ${app}\n })()`, context);
  return { document, window, actions, get stored() { return stored; }, fail(message) { rejectNext = message; }, update(language) { stored.settings.language = language; changed({ [core.STORAGE_KEY]: { newValue: structuredClone(stored) } }); } };
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
