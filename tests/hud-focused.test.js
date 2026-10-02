import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { newState, reduce } from '../core.js';
import { hudSummary, hudAction } from '../hud-state.js';

const today = new Date('2026-10-03T04:35:00Z');
const yesterday = new Date('2026-10-02T04:20:00Z');
const source = ['i18n.js', 'relic-icons.js', 'hud-theme.js', 'hud.js'].map(file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).join('\n');
const flush = () => new Promise(resolve => setImmediate(resolve));
const clone = value => JSON.parse(JSON.stringify(value));

function initial({ mode = 'full', language = 'zh-CN' } = {}) {
  let state = reduce(newState(), { type: 'settings', username: 'soap628', posts: 3, replies: 10 }, yesterday);
  state = reduce(state, { type: 'daily', date: '2026-10-03', posts: 2, replies: 4, note: '' }, today);
  state = reduce(state, { type: 'language', language }, today);
  return reduce(state, { type: 'hud-preferences', preferences: { mode } }, today);
}

function setup(saved = initial()) {
  const { document, window } = parseHTML('<html><body><main>X remains here</main></body></html>');
  window.innerWidth = 1440; window.innerHeight = 900;
  const ctx = vm.createContext({ document, window,
    MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: callback => callback(),
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
    chrome: { runtime: { getManifest: () => ({ version: '1.0.0-test' }), getURL: file => `chrome-extension://fixture/${file}` } }
  });
  vm.runInContext(source, ctx);
  let state = saved;
  const commands = [];
  const hud = ctx.XFocusHUD.mount({ getBounds: () => ({ left: 260, right: 1160 }), onCommand: async message => {
    commands.push(clone(message)); state = reduce(state, hudAction(message, state), today); return hudSummary(state, today);
  } });
  const root = document.getElementById('x-focus-hud').shadowRoot;
  const q = selector => root.querySelector(selector), all = selector => [...root.querySelectorAll(selector)];
  hud.update(hudSummary(state, today));
  return { hud, q, all, root, document, window, commands, state: () => state,
    nav: view => q(`.view-nav [data-view="${view}"]`),
    dispatch(action, at = today) { state = reduce(state, action, at); hud.update(hudSummary(state, today)); },
    capture(values, at = today) { state = reduce(state, { type: 'capture', username: 'soap628', posts: [], ...values }, at); hud.update(hudSummary(state, today)); }
  };
}

test('four explicit navigation buttons retain the selected view through incoming progress updates', () => {
  const e = setup(), views = ['quests', 'assessment-panel', 'inventory-panel', 'settings'];
  assert.deepEqual(e.all('.view-nav button').map(button => button.dataset.view), views);
  for (const view of views) {
    e.nav(view).click();
    assert.equal(e.q('.card').dataset.view, view);
    assert.deepEqual(e.all('.view-nav [aria-pressed="true"]').map(button => button.dataset.view), [view]);
    e.dispatch({ type: 'adjust', kind: 'replies', amount: 1 });
    assert.equal(e.q('.card').dataset.view, view, 'new counts do not throw the user out of the open view');
    assert.deepEqual(e.all('.view-nav [aria-pressed="true"]').map(button => button.dataset.view), [view]);
    for (const section of views.slice(1)) assert.equal(e.q('.' + section).hidden, section !== view);
    assert.equal(e.q('.panel-toolbar').hidden, view === 'quests');
  }
  assert.equal(e.q('.quest[data-kind="replies"] .count').textContent, '8 / 10');
  assert.equal(e.commands.length, 0, 'navigation does not generate mutations in stored progress');
  e.hud.destroy();
});

test('settings capture-status shortcut and back button provide a direct route home without changing data', () => {
  const e = setup(), before = clone(e.state());
  e.hud.setConnection({ status: 'ready', code: 'ready', params: { active: 'soap628', bound: 'soap628' } });
  e.nav('settings').click();
  assert.ok(e.q('.settings .status-shortcut'));
  e.q('.status-shortcut').click();
  assert.equal(e.q('.card').dataset.view, 'connection-panel');
  assert.equal(e.q('.settings').hidden, true);
  assert.equal(e.q('.connection-panel').hidden, false);
  assert.equal(e.q('.connection-account').textContent, '@soap628');
  assert.equal(e.q('.extension-version').textContent, '1.0.0-test');
  assert.match(e.q('.connection-message').textContent, /已连接/);
  e.q('.back-quests').click();
  assert.equal(e.q('.card').dataset.view, 'quests');
  assert.equal(e.q('.connection-panel').hidden, true);
  assert.equal(e.nav('quests').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(clone(e.state()), before);
  assert.equal(e.commands.length, 0);
  e.hud.destroy();
});

test('the mini expansion affordance leads into editable goals and back to live task counts', async () => {
  const e = setup(initial({ mode: 'mini' })), before = hudSummary(e.state(), today).totalXp;
  assert.equal(e.q('.hud').classList.contains('mini'), true);
  assert.match(e.q('.mini-expand').textContent, /展开面板/);
  e.q('.mini-expand').click(); await flush();
  assert.equal(e.q('.hud').classList.contains('mini'), false);
  e.nav('settings').click();
  e.q('input[name="posts"]').value = '5'; e.q('input[name="replies"]').value = '20';
  e.q('form').dispatchEvent(new e.window.Event('submit', { cancelable: true })); await flush();
  assert.equal(e.q('.card').dataset.view, 'settings', 'saving targets keeps the form view open');
  e.q('.back-quests').click();
  assert.equal(e.q('.quest[data-kind="posts"] .count').textContent, '2 / 5');
  assert.equal(e.q('.quest[data-kind="replies"] .count').textContent, '4 / 20');
  assert.equal(e.state().hudPreferences.mode, 'full');
  assert.equal(hudSummary(e.state(), today).totalXp, before);
  assert.deepEqual(e.commands.map(command => command.command), ['hud-preferences', 'goals']);
  e.hud.destroy();
});

test('the account area contains followers only while account blue verification and action EXP remain', () => {
  const e = setup(), before = hudSummary(e.state(), today).totalXp;
  e.capture({ followers: { value: 3784, approximate: false }, verifiedFollowers: { value: 2700, approximate: true }, blueVerified: true,
    analyticsSummary: { period: { label: '7D', days: 7, start: null, end: null }, impressions: { value: 239600, approximate: true }, engagements: { value: 5500, approximate: true } } });
  assert.equal(e.q('.followers .metric-value').textContent, '3,784');
  assert.equal(e.all('.metrics > div').length, 1);
  for (const selector of ['.views', '.engagements', '.verified-followers']) assert.equal(e.q(selector), null);
  assert.doesNotMatch(e.q('.metrics').textContent, /曝光|互动|认证粉丝|239|5,500/);
  assert.equal(e.q('.verified-badge').hidden, false);
  assert.equal(e.q('.follower-profile').getAttribute('href'), 'https://x.com/soap628');
  assert.equal(e.q('.profile-link').getAttribute('href'), 'https://x.com/soap628');
  assert.equal(hudSummary(e.state(), today).totalXp, before);
  assert.equal(e.q('.quest[data-kind="posts"] .quest-reward').textContent, '+5 EXP');
  assert.equal(e.q('.quest[data-kind="replies"] .quest-reward').textContent, '+1 EXP');
  e.capture({ blueVerified: false });
  assert.equal(e.q('.verified-badge').hidden, true);
  e.hud.destroy();
});

test('missing follower data differs from a genuine zero baseline and displays its read time', () => {
  const e = setup();
  assert.equal(e.q('.followers .metric-value').textContent, '—');
  assert.equal(e.q('.follower-freshness').textContent, '尚未读取粉丝数');
  assert.match(e.q('.follower-baseline').textContent, /本人主页/);
  e.capture({ followers: { value: 0, approximate: false } });
  assert.equal(e.q('.followers .metric-value').textContent, '0');
  assert.equal(e.q('.delta').textContent, '');
  assert.equal(e.q('.follower-baseline').textContent, '已建立基线，下一天记录即可比较');
  assert.match(e.q('.follower-freshness').textContent, /10\/03.*12:35/);
  assert.equal(e.q('.follower-freshness').classList.contains('stale'), false);
  e.hud.destroy();
});

test('follower growth shows the actual dated baseline including zero and losses without inventing a fresh read', () => {
  for (const [value, expected] of [[3784, '+0'], [3772, '-12']]) {
    let state = initial();
    state = reduce(state, { type: 'capture', username: 'soap628', followers: { value: 3784, approximate: false }, posts: [] }, yesterday);
    const e = setup(state), before = hudSummary(state, today).totalXp;
    assert.equal(e.q('.followers .metric-label').textContent, '粉丝 · 上次');
    assert.match(e.q('.follower-freshness').textContent, /10\/02.*12:20/);
    assert.equal(e.q('.follower-freshness').classList.contains('stale'), true);
    e.capture({ followers: { value, approximate: false } });
    assert.equal(e.q('.followers .metric-label').textContent, '粉丝');
    assert.equal(e.q('.delta').textContent, expected);
    assert.equal(e.q('.delta').classList.contains('negative'), value < 3784);
    assert.equal(e.q('.follower-baseline').textContent, '较 2026-10-02 的粉丝变化');
    assert.match(e.q('.follower-freshness').textContent, /10\/03.*12:35/);
    assert.equal(e.q('.follower-freshness').classList.contains('stale'), false);
    assert.equal(hudSummary(e.state(), today).totalXp, before);
    e.hud.destroy();
  }
});

test('switching languages updates explicit navigation, current page and follower help in place', async () => {
  const e = setup();
  assert.deepEqual(e.all('.view-nav [data-i18n]').map(node => node.textContent), ['任务', '成长', '宝物', '设置']);
  e.nav('settings').click();
  assert.equal(e.q('.current-view').textContent, '设置');
  const before = clone(e.state().days);
  for (const option of e.q('.language-select').querySelectorAll('option')) option.selected = option.value === 'en';
  e.q('.language-select').dispatchEvent(new e.window.Event('change')); await flush();
  assert.equal(e.state().settings.language, 'en');
  assert.equal(e.q('.hud').getAttribute('lang'), 'en');
  assert.deepEqual(e.all('.view-nav [data-i18n]').map(node => node.textContent), ['Quests', 'Growth', 'Relics', 'Settings']);
  assert.equal(e.q('.current-view').textContent, 'Settings');
  assert.equal(e.q('.card').dataset.view, 'settings');
  assert.equal(e.q('.back-quests').textContent, '‹ Back to quests');
  assert.equal(e.q('.status-shortcut').textContent, 'Capture status');
  assert.match(e.q('.mini-expand').textContent, /Open panel/);
  assert.equal(e.q('.follower-freshness').textContent, 'No follower count yet');
  assert.match(e.q('.follower-baseline').textContent, /Open your profile/);
  assert.deepEqual(clone(e.state().days), before);
  e.hud.destroy();
});
