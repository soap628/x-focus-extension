import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { newState, reduce } from '../core.js';
import { hudSummary } from '../hud-state.js';
const now = new Date('2026-09-26T12:00:00Z');
const source = ['i18n.js', 'relic-icons.js', 'hud-theme.js', 'hud.js'].map(name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')).join('\n');
function setup({ posts = 0, replies = 0 } = {}) {
  const { document, window } = parseHTML('<html><body><main>X page</main></body></html>'); window.innerWidth = 1920;
  const timeouts = [];
  const context = vm.createContext({ document, window, MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: f => f(), setInterval: () => 0, clearInterval() {}, setTimeout: f => timeouts.push(f), clearTimeout() {} });
  vm.runInContext(source, context);
  let state = reduce(newState(), { type: 'settings', username: 'soap628', posts: 2, replies: 10 }, now);
  state.hudPreferences.mode = 'full';
  Object.assign(state.days['2026-09-26'], { posts, replies });
  const hud = context.XFocusHUD.mount({ getBounds: () => ({ left: 410, right: 1510 }) });
  const root = document.querySelector('#x-focus-hud').shadowRoot;
  const render = () => hud.update(hudSummary(state, now));
  render();
  return { hud, root, timeouts, render, act(action) { state = reduce(state, action, now); render(); } };
}
test('experience feedback occurs once for an action, never on initial load or duplicate updates', () => {
  const e = setup({ posts: 50 });
  assert.equal(e.root.querySelector('.reward-float').hidden, true);
  e.act({ type: 'adjust', kind: 'posts', amount: 1 });
  assert.equal(e.root.querySelector('.reward-float').textContent, '+5 EXP');
  assert.equal(e.timeouts.length, 1);
  e.render(); e.render();
  assert.equal(e.timeouts.length, 1);
  e.timeouts[0]();
  assert.equal(e.root.querySelector('.reward-float').hidden, true);
  e.hud.destroy();
});
test('level-up feedback follows each full 100 EXP earned from recorded actions', () => {
  const e = setup({ posts: 79, replies: 4 }); // 399 EXP: Lv.4, one reply away from Lv.5.
  assert.match(e.root.querySelector('.level').textContent, /04/);
  e.act({ type: 'adjust', kind: 'replies', amount: 1 });
  assert.equal(e.root.querySelector('.reward-float').textContent, '升至 LV. 5');
  assert.equal(e.root.querySelector('.rank').textContent, '暮光游侠');
  assert.equal(e.root.querySelector('.card').classList.contains('level-up'), true);
  e.hud.destroy();
});
test('Analytics period changes update the metric display without moving EXP or creating rewards', () => {
  const e = setup({ posts: 5, replies: 10 });
  assert.equal(e.root.querySelector('.xp-num').textContent, '35 / 100 EXP');
  for (const [label, days, impressions, engagements] of [['2W', 14, 98000, 3200], ['7D', 7, 700000, 100000], ['1Y', 365, 9000000, 800000]]) {
    e.act({ type: 'capture', username: 'soap628', followers: { value: 100000 }, verifiedFollowers: { value: 25000 }, analyticsSummary: { period: { label, days, start: null, end: null }, impressions: { value: impressions }, engagements: { value: engagements } } });
    assert.equal(e.root.querySelector('.xp-num').textContent, '35 / 100 EXP');
    assert.equal(e.root.querySelector('.level').textContent, 'LV. 01');
    assert.equal(e.root.querySelector('.xp-row .fill').style.width, '35%');
    assert.match(e.root.querySelector('.views .metric-label').textContent, new RegExp(label));
    assert.equal(e.root.querySelector('.reward-float').hidden, true);
  }
  assert.equal(e.timeouts.length, 0); e.hud.destroy();
});
test('action levels and their experience display continue beyond the former level fifty cap', () => {
  const e = setup({ posts: 1000 });
  assert.equal(e.root.querySelector('.level').textContent, 'LV. 51');
  assert.equal(e.root.querySelector('.xp-num').textContent, '0 / 100 EXP');
  assert.equal(e.root.querySelector('.assessment-coverage').textContent, '距下一级 100 EXP');
  assert.equal(e.root.querySelector('.xp-row .fill').style.width, '0%');
  e.act({ type: 'adjust', kind: 'replies', amount: 1 });
  assert.equal(e.root.querySelector('.reward-float').textContent, '+1 EXP');
  assert.equal(e.root.querySelector('.xp-num').textContent, '1 / 100 EXP');
  e.hud.destroy();
});
test('lowering goals can complete quests without pretending to earn more experience', () => {
  const e = setup({ posts: 1, replies: 6 });
  e.act({ type: 'settings', username: 'soap628', posts: 1, replies: 6 });
  assert.equal(e.root.querySelector('.completion').hidden, false);
  assert.equal(e.root.querySelector('.quest-total').textContent, '2 / 2');
  assert.equal(e.root.querySelector('.reward-float').hidden, true);
  assert.equal(e.timeouts.length, 0);
  e.hud.destroy();
});
test('connection errors remain visible even when tracking is paused; diagnostics are independent from goals', () => {
  const e = setup();
  e.act({ type: 'tracking', enabled: false });
  e.hud.setConnection({ status: 'error', message: '扩展已更新，请刷新 X 页面' });
  assert.equal(e.root.querySelector('.status').textContent, '需要刷新页面');
  e.root.querySelector('.connection-toggle').click();
  assert.equal(e.root.querySelector('.connection-panel').hidden, false);
  assert.match(e.root.querySelector('.connection-message').textContent, /刷新/);
  e.root.querySelector('.settings-toggle').click();
  assert.equal(e.root.querySelector('.connection-panel').hidden, true);
  assert.equal(e.root.querySelector('.settings').hidden, false);
  e.hud.destroy();
});
