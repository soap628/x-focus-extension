import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { newState, reduce } from '../core.js';
import { hudSummary, hudAction } from '../hud-state.js';
import { initializeRewards, settleRewards, openChest } from '../rewards.js';

const now = new Date('2026-09-26T12:00:00Z');
const source = ['i18n.js', 'relic-icons.js', 'hud-theme.js', 'hud.js'].map(name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')).join('\n');
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  const { document, window } = parseHTML('<html><body><main>X remains untouched</main></body></html>'); window.innerWidth = 1920;
  const context = vm.createContext({ document, window, MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: f => f(), setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {} });
  vm.runInContext(source, context);
  let state = reduce(newState(), { type: 'settings', username: 'soap628', posts: 2, replies: 10 }, now);
  state.hudPreferences.mode = 'full';
  state = reduce(state, { type: 'capture', username: 'soap628', posts: [], blueVerified: true, verifiedFollowers: { value: 2200, approximate: true }, analyticsSummary: { period: { label: '2W', days: 14, start: null, end: null }, impressions: { value: 98000, approximate: true }, engagements: { value: 3200, approximate: true } } }, now);
  state = initializeRewards(state, now);
  state.rewards.earned = [{ id: 'level:5', reason: 'level', level: 5, date: '2026-09-26', openedAt: null, itemId: null }];
  const commands = [];
  const hud = context.XFocusHUD.mount({ getBounds: () => ({ left: 410, right: 1510 }), onCommand: async message => {
    commands.push(message); await tick();
    if (message.command === 'open-chest') state = openChest(state, undefined, now, () => 0);
    else if (message.command !== 'scan-now') { const action = hudAction(message, state); state = settleRewards(state, reduce(state, action, now), action, now); }
    return hudSummary(state, now);
  } });
  hud.update(hudSummary(state, now)); hud.setConnection({ status: 'ready', code: 'ready', message: '自动记录已连接，等待本页活动' });
  return { hud, document, window, commands, root: document.querySelector('#x-focus-hud').shadowRoot, state: () => state };
}

test('switching HUD language preserves draft goal inputs and localizes all rendered guidance', async () => {
  const e = setup(), q = s => e.root.querySelector(s);
  q('.settings-toggle').click(); q('input[name="posts"]').value = '17';
  for (const option of q('.language-select').querySelectorAll('option')) option.selected = option.value === 'en';
  q('.language-select').dispatchEvent(new e.window.Event('change'));
  await tick(); await tick();
  assert.equal(e.state().settings.language, 'en');
  assert.equal(q('input[name="posts"]').value, '17');
  assert.equal(q('.settings-toggle').getAttribute('aria-label'), 'Quest settings');
  assert.equal(q('.verified-badge').getAttribute('aria-label'), 'X blue verified');
  assert.equal(q('.views .metric-label').textContent, '2W Impressions');
  assert.equal(q('.status').textContent, 'Capture connected');
  assert.match(q('.connection-message').textContent, /connected/i);
  assert.equal(q('.relic-grid').children.length, 12);
  for (const element of e.root.querySelectorAll('*')) {
    if (['STYLE', 'OPTION'].includes(element.tagName)) continue;
    if (!element.children.length) assert.doesNotMatch(element.textContent, /[\u3400-\u9fff]/u, `Chinese in ${element.className || element.tagName}`);
    for (const attribute of ['title', 'aria-label']) assert.doesNotMatch(element.getAttribute(attribute) || '', /[\u3400-\u9fff]/u, `Chinese ${attribute} in ${element.className}`);
  }
  q('.assessment-toggle').click(); assert.equal(q('.settings').hidden, true); assert.equal(q('.assessment-panel').hidden, false);
  assert.match(q('.dimensions').textContent, /Lifetime posts0 EXP0 × 5 EXP/);
  assert.match(q('.dimensions').textContent, /Lifetime replies0 EXP0 × 1 EXP/);
  assert.match(q('.score-rules').textContent, /Every 100 EXP|every 100 EXP/);
  assert.match(q('.score-rules').textContent, /no level cap/);
  assert.equal(q('.xp-num').textContent, '0 / 100 EXP');
  assert.match(q('.views').title, /14-day average/);
  assert.match(q('.views').title, /does not affect level/);
  assert.equal(e.document.querySelector('main').textContent, 'X remains untouched'); e.hud.destroy();
});

test('one chest click is serialized, reveals a stored item, and repeated renders cannot reroll', async () => {
  const e = setup(), q = s => e.root.querySelector(s);
  q('.inventory-toggle').click(); assert.equal(q('.inventory-panel').hidden, false);
  q('.open-chest').click(); q('.open-chest').click();
  await tick(); await tick();
  assert.equal(e.commands.filter(c => c.command === 'open-chest').length, 1);
  assert.equal(e.state().rewards.earned[0].itemId, 'quill');
  assert.equal(q('.item-detail').hidden, false); assert.match(q('.item-name').textContent, /羽笔/);
  assert.equal(q('.open-chest').disabled, true);
  e.hud.update(hudSummary(e.state(), now));
  assert.equal(e.root.querySelectorAll('.relic.owned').length, 1);
  assert.equal(q('.chest-count').hidden, true);
  assert.equal(e.state().days['2026-09-26'].posts, 0, 'cosmetic drops never publish or increase counts');
  q('.settings-toggle').click(); assert.equal(q('.inventory-panel').hidden, true); e.hud.destroy();
});

test('scan control uses the local command and remains disabled for an account mismatch', async () => {
  const e = setup(), q = s => e.root.querySelector(s);
  q('.connection-toggle').click(); q('.scan-now').click();
  await tick(); await tick();
  assert.equal(e.commands.filter(c => c.command === 'scan-now').length, 1);
  assert.equal(e.state().days['2026-09-26'].posts, 0);
  e.hud.setConnection({ status: 'account-mismatch', code: 'mismatch', params: { active: 'another', bound: 'soap628' }, message: '账号不一致' });
  assert.equal(q('.scan-now').disabled, true); e.hud.destroy();
});
