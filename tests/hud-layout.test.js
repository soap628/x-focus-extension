import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { newState, reduce, validateBackup } from '../core.js';
import { hudSummary, hudAction } from '../hud-state.js';

const now = new Date('2026-09-26T12:00:00Z');
const source = ['i18n.js', 'relic-icons.js', 'hud-theme.js', 'hud.js'].map(file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).join('\n');
const tick = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
function initialState() {
  let state = reduce(newState(), { type: 'settings', username: 'demo_creator', posts: 3, replies: 10 }, now);
  return reduce(state, { type: 'daily', date: '2026-09-26', posts: 2, replies: 7, note: '' }, now);
}
function setup(saved = initialState(), { deferPreferences = false } = {}) {
  const { document, window } = parseHTML('<html><body><main>X page</main></body></html>');
  window.innerWidth = 1280; window.innerHeight = 800;
  const lifecycle = { observers: 0, observations: 0, disconnects: 0, intervals: 0, clearedIntervals: 0 };
  const context = vm.createContext({ document, window, MutationObserver: class {
    constructor() { lifecycle.observers++; } observe() { lifecycle.observations++; } disconnect() { lifecycle.disconnects++; }
  }, requestAnimationFrame: callback => callback(), setInterval: () => ++lifecycle.intervals,
    clearInterval() { lifecycle.clearedIntervals++; }, setTimeout: () => 0, clearTimeout() {} });
  vm.runInContext(source, context);
  let state = saved;
  const commands = [], pendingPreferences = [];
  const hud = context.XFocusHUD.mount({ getBounds: () => ({ left: 300, right: 980 }), onCommand: async message => {
    commands.push(plain(message));
    if (deferPreferences && message.command === 'hud-preferences') await new Promise(resolve => pendingPreferences.push(resolve));
    state = reduce(state, hudAction(message, state), now);
    return hudSummary(state, now);
  } });
  const root = document.querySelector('#x-focus-hud').shadowRoot, q = selector => root.querySelector(selector);
  const rect = () => {
    const left = Number.parseFloat(q('.hud').style.left) || 0, top = Number.parseFloat(q('.hud').style.top) || 0;
    const width = Number.parseFloat(q('.hud').style.width) || 232;
    const height = q('.hud').classList.contains('mini') ? 176 : 430;
    return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height };
  };
  q('.hud').getBoundingClientRect = rect;
  q('.card').getBoundingClientRect = rect;
  const captures = new Set();
  q('.heading').setPointerCapture = id => captures.add(id);
  q('.heading').releasePointerCapture = id => captures.delete(id);
  q('.heading').hasPointerCapture = id => captures.has(id);
  hud.update(hudSummary(state, now));
  function pointer(target, type, x, y, extras = {}) {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({ pointerId: 7, button: 0, isPrimary: true, clientX: x, clientY: y, ...extras })) Object.defineProperty(event, key, { value });
    target.dispatchEvent(event);
    return event;
  }
  function key(target, value, extras = {}) {
    const event = new window.Event('keydown', { bubbles: true, cancelable: true });
    for (const [name, setting] of Object.entries({ key: value, shiftKey: false, ...extras })) Object.defineProperty(event, name, { value: setting });
    target.dispatchEvent(event);
    return event;
  }
  return { hud, root, q, window, document, context, rect, pointer, key, commands, pendingPreferences, lifecycle, state: () => state,
    preferences: () => commands.filter(command => command.command === 'hud-preferences'),
    async resize(width, height) { window.innerWidth = width; window.innerHeight = height; window.dispatchEvent(new window.Event('resize')); await tick(); }
  };
}

test('mini is the first-run mode, and switching views persists without changing actions or EXP', async () => {
  const e = setup(), before = plain(e.state().days);
  assert.equal(e.q('.hud').classList.contains('mini'), true);
  assert.equal(e.q('.card').hidden, false, 'mini remains a visible card rather than an orb-only state');
  e.q('.minimize').click(); await tick();
  assert.equal(e.state().hudPreferences.mode, 'full');
  assert.equal(e.q('.hud').classList.contains('mini'), false);
  assert.deepEqual(e.preferences().at(-1).preferences, { mode: 'full' });
  const restored = setup(validateBackup(plain(e.state())));
  assert.equal(restored.q('.hud').classList.contains('mini'), false, 'a new mount reflects saved full mode');
  e.q('.minimize').click(); await tick();
  assert.equal(e.state().hudPreferences.mode, 'mini');
  assert.deepEqual(plain(e.state().days), before);
  assert.equal(hudSummary(e.state(), now).totalXp, 17);
  assert.equal(e.document.querySelector('main').textContent, 'X page');
  restored.hud.destroy(); e.hud.destroy();
});

test('dock controls save independent position patches and automatic placement clears only position', async () => {
  const state = initialState(); state.hudPreferences.mode = 'full';
  const e = setup(state); e.q('.settings-toggle').click();
  e.q('.dock-left').click(); await tick();
  assert.equal(e.state().hudPreferences.position.anchor, 'left');
  assert.equal(e.rect().left, 4);
  assert.equal(e.state().hudPreferences.mode, 'full');
  e.q('.dock-right').click(); await tick();
  assert.equal(e.state().hudPreferences.position.anchor, 'right');
  assert.equal(e.rect().right, e.window.innerWidth - 4);
  const restored = setup(validateBackup(plain(e.state())));
  assert.equal(restored.rect().right, restored.window.innerWidth - 4);
  e.q('.position-auto').click(); await tick();
  assert.equal(e.state().hudPreferences.position, null);
  assert.equal(e.state().hudPreferences.mode, 'full');
  assert.equal(e.preferences().at(-1).preferences.position, null);
  restored.hud.destroy(); e.hud.destroy();
});

test('resolveLayout keeps normalized free and docked positions within resized viewport bounds', () => {
  const context = vm.createContext({}); vm.runInContext(source, context);
  const resolve = context.XFocusHUD.resolveLayout;
  assert.equal(typeof resolve, 'function');
  for (const [viewportWidth, viewportHeight, width, height] of [[1920, 1080, 232, 430], [390, 844, 232, 430], [180, 240, 232, 430]]) {
    for (const anchor of ['left', 'right', 'free']) for (const point of [0, .5, 1]) {
      const result = resolve({ viewportWidth, viewportHeight, width, height, bounds: null, position: { anchor, x: point, y: point } });
      assert.ok(Number.isFinite(result.left) && Number.isFinite(result.top));
      assert.ok(result.left >= 4);
      assert.ok(result.left + result.width <= viewportWidth - 4);
      assert.ok(result.top >= 4 && result.top <= Math.max(4, viewportHeight - Math.min(height, viewportHeight - 8) - 4));
      if (anchor === 'left') assert.equal(result.left, 4);
      if (anchor === 'right') assert.equal(result.left + result.width, viewportWidth - 4);
    }
  }
  const centered = resolve({ viewportWidth: 1280, viewportHeight: 800, width: 232, height: 430, bounds: null, position: { anchor: 'free', x: .5, y: .5 } });
  assert.equal(centered.left, 524); assert.equal(centered.top, 185);
});

test('resizing reprojects a saved free position without mutating the preference', async () => {
  const state = initialState(); state.hudPreferences = { mode: 'full', position: { anchor: 'free', x: 1, y: 1 } };
  const e = setup(state), saved = plain(e.state().hudPreferences);
  await e.resize(390, 844);
  assert.ok(e.rect().left >= 4 && e.rect().right <= 386);
  assert.ok(e.rect().top >= 4 && e.rect().bottom <= 840);
  assert.deepEqual(e.state().hudPreferences, saved);
  assert.equal(e.preferences().length, 0, 'viewport changes do not overwrite normalized saved coordinates');
  e.hud.destroy();
});

test('docked placement uses the visible document area when scrollbars occupy the window edge', async () => {
  const state = initialState(); state.hudPreferences = { mode: 'mini', position: { anchor: 'right', x: 1, y: 1 } };
  const e = setup(state);
  Object.defineProperty(e.document.documentElement, 'clientWidth', { value: 1265, configurable: true });
  Object.defineProperty(e.document.documentElement, 'clientHeight', { value: 785, configurable: true });
  await e.resize(1280, 800);
  assert.equal(e.rect().right, 1261, 'right controls remain clear of the vertical scrollbar');
  assert.equal(e.rect().bottom, 781, 'the bottom edge also uses the visible content height');
  assert.equal(e.preferences().length, 0);
  e.hud.destroy();
});

test('heading drags persist normalized free coordinates and restore on a new mount', async () => {
  const e = setup(), start = e.rect(), before = plain(e.state().days);
  const x = start.left + 20, y = start.top + 12;
  e.pointer(e.q('.heading b'), 'pointerdown', x, y);
  e.pointer(e.window, 'pointermove', x - 260, y + 100);
  assert.equal(e.q('.hud').classList.contains('dragging'), true);
  assert.equal(e.rect().left, start.left - 260);
  assert.equal(e.preferences().length, 0, 'movement is transient until pointer release');
  e.pointer(e.window, 'pointerup', x - 280, y + 120); await tick();
  const position = e.state().hudPreferences.position;
  assert.equal(position.anchor, 'free');
  assert.equal(e.rect().left, start.left - 280, 'pointerup consumes the final position');
  assert.equal(e.rect().top, start.top + 120);
  assert.equal(position.x, (e.rect().left - 4) / (e.window.innerWidth - e.rect().width - 8));
  assert.equal(position.y, (e.rect().top - 4) / (e.window.innerHeight - e.rect().height - 8));
  assert.equal(e.q('.hud').classList.contains('dragging'), false);
  assert.equal(e.preferences().length, 1);
  const restored = setup(validateBackup(plain(e.state())));
  assert.equal(restored.rect().left, e.rect().left);
  assert.equal(restored.rect().top, e.rect().top);
  assert.deepEqual(plain(e.state().days), before);
  assert.equal(hudSummary(e.state(), now).totalXp, 17);
  restored.hud.destroy(); e.hud.destroy();
});

test('dragging starts at four pixels and controls do not start dragging', async () => {
  const state = initialState(); state.hudPreferences = { mode: 'full', position: { anchor: 'free', x: .5, y: .5 } };
  const e = setup(state), start = e.rect(), x = start.left + 20, y = start.top + 12;
  e.pointer(e.q('.heading'), 'pointerdown', x, y);
  e.pointer(e.window, 'pointermove', x + 3, y);
  e.pointer(e.window, 'pointerup', x + 3, y); await tick();
  assert.equal(e.preferences().length, 0);
  assert.equal(e.rect().left, start.left);
  e.pointer(e.q('.heading'), 'pointerdown', x, y);
  e.pointer(e.window, 'pointerup', x + 4, y); await tick();
  assert.equal(e.preferences().length, 1);
  assert.equal(e.rect().left, start.left + 4);
  const moved = e.rect();
  for (const selector of ['.settings-toggle', '.minimize']) {
    const target = e.q(selector).firstElementChild || e.q(selector);
    e.pointer(target, 'pointerdown', x, y);
    e.pointer(e.window, 'pointermove', x - 150, y + 50);
    e.pointer(e.window, 'pointerup', x - 150, y + 50); await tick();
    assert.equal(e.preferences().length, 1, `${selector} descendants must not drag`);
    assert.equal(e.rect().left, moved.left);
  }
  e.q('.settings-toggle').click();
  assert.equal(e.q('.settings').hidden, false, 'the control still performs its normal action');
  e.hud.destroy();
});

test('pointer drags snap near both edges and retain vertical position on reload', async () => {
  const e = setup();
  for (const anchor of ['left', 'right']) {
    const start = e.rect(), targetLeft = anchor === 'left' ? 20 : e.window.innerWidth - start.width - 20;
    e.pointer(e.q('.heading'), 'pointerdown', start.left + 20, start.top + 12);
    e.pointer(e.window, 'pointerup', targetLeft + 20, start.top + 52); await tick();
    assert.equal(e.state().hudPreferences.position.anchor, anchor);
    assert.equal(e.state().hudPreferences.position.x, anchor === 'left' ? 0 : 1);
    assert.equal(anchor === 'left' ? e.rect().left : e.window.innerWidth - e.rect().right, 4);
    const restored = setup(validateBackup(plain(e.state())));
    assert.equal(restored.rect().left, e.rect().left);
    assert.equal(restored.rect().top, e.rect().top);
    restored.hud.destroy();
  }
  e.hud.destroy();
});

test('pointer cancellation and Escape roll back a drag without saving or changing mode', async () => {
  const state = initialState(); state.hudPreferences = { mode: 'full', position: { anchor: 'free', x: .4, y: .3 } };
  const e = setup(state), initial = e.rect(), saved = plain(e.state().hudPreferences);
  for (const cancel of ['pointercancel', 'Escape', 'blur', 'lostpointercapture']) {
    e.pointer(e.q('.heading'), 'pointerdown', initial.left + 10, initial.top + 10);
    e.pointer(e.window, 'pointermove', initial.left + 130, initial.top + 100);
    assert.notEqual(e.rect().left, initial.left);
    if (cancel === 'Escape') e.key(e.q('.heading'), 'Escape');
    else if (cancel === 'lostpointercapture') e.pointer(e.q('.heading'), cancel, 0, 0);
    else e.pointer(e.window, cancel, 0, 0);
    e.pointer(e.window, 'pointerup', initial.left + 130, initial.top + 100); await tick();
    assert.equal(e.rect().left, initial.left, `${cancel} restores horizontal position`);
    assert.equal(e.rect().top, initial.top, `${cancel} restores vertical position`);
    assert.equal(e.q('.hud').classList.contains('dragging'), false);
    assert.deepEqual(e.state().hudPreferences, saved);
    assert.equal(e.preferences().length, 0);
  }
  e.hud.destroy();
});

test('keyboard movement can leave a dock horizontally while vertical movement preserves it', async () => {
  const state = initialState(); state.hudPreferences = { mode: 'mini', position: { anchor: 'right', x: 1, y: .3 } };
  const e = setup(state), initial = e.rect();
  e.key(e.q('.heading'), 'ArrowDown'); await tick();
  assert.equal(e.state().hudPreferences.position.anchor, 'right');
  assert.equal(e.rect().right, e.window.innerWidth - 4);
  assert.equal(e.rect().top, initial.top + 10);
  e.key(e.q('.heading'), 'ArrowLeft'); await tick();
  assert.equal(e.state().hudPreferences.position.anchor, 'free');
  assert.equal(e.rect().left, initial.left - 10, 'keyboard movement does not immediately snap back');
  e.key(e.q('.heading'), 'ArrowLeft', { shiftKey: true }); await tick();
  assert.equal(e.rect().left, initial.left - 50);
  e.hud.destroy();
});

test('rapid mode changes queue saves and stale responses do not overwrite the latest visible mode', async () => {
  const e = setup(initialState(), { deferPreferences: true });
  e.q('.minimize').click(); e.q('.minimize').click(); e.q('.minimize').click();
  assert.equal(e.q('.hud').classList.contains('mini'), false);
  await tick();
  for (let i = 0; i < 3; i++) {
    assert.equal(e.pendingPreferences.length, 1, 'preference saves are serialized');
    e.pendingPreferences.shift()(); await tick();
    assert.equal(e.q('.hud').classList.contains('mini'), false, 'older responses retain the latest optimistic mode');
  }
  assert.deepEqual(e.preferences().map(message => message.preferences.mode), ['full', 'mini', 'full']);
  assert.equal(e.state().hudPreferences.mode, 'full');
  assert.equal(hudSummary(e.state(), now).totalXp, 17);
  e.hud.destroy();
});

test('reconnecting a detached HUD retains its shadow nodes, handlers, preferences and progress', async () => {
  const state = initialState(); state.hudPreferences = { mode: 'full', position: { anchor: 'right', x: 1, y: .4 } };
  const e = setup(state), host = e.document.getElementById('x-focus-hud'), heading = e.q('.heading');
  const saved = plain(e.state()), initialRect = e.rect();
  host.remove();
  assert.equal(host.isConnected, false);
  assert.equal(e.hud.ensureConnected(), true);
  assert.equal(e.document.getElementById('x-focus-hud'), host);
  assert.equal(host.shadowRoot, e.root);
  assert.equal(e.q('.heading'), heading);
  assert.deepEqual(e.rect(), initialRect);
  assert.deepEqual(plain(e.state()), saved);
  e.q('.view-nav [data-view="settings"]').click();
  assert.equal(e.q('.settings').hidden, false, 'the original navigation event handler still opens settings');
  e.q('.dock-left').click(); await tick();
  assert.equal(e.preferences().length, 1, 'reattachment does not duplicate the button handler');
  assert.equal(e.state().hudPreferences.position.anchor, 'left');
  assert.equal(e.rect().left, 4);
  assert.deepEqual(plain(e.state().days), saved.days);
  assert.equal(hudSummary(e.state(), now).totalXp, 17);
  assert.deepEqual(e.lifecycle, { observers: 1, observations: 1, disconnects: 0, intervals: 1, clearedIntervals: 0 });
  e.hud.destroy();
});

test('body replacement reuses the HUD and connected reconciliation performs no page writes', async () => {
  const e = setup(), host = e.document.getElementById('x-focus-hud'), saved = plain(e.state());
  const body = e.document.createElement('body'); body.innerHTML = '<main>New X page</main>';
  e.document.body.replaceWith(body);
  let appends = 0;
  const append = body.append;
  body.append = function (...nodes) { appends++; return append.apply(this, nodes); };
  assert.equal(e.hud.ensureConnected(), true);
  assert.equal(host.parentNode, body);
  assert.equal(host.shadowRoot, e.root);
  assert.equal(appends, 1);
  for (let i = 0; i < 20; i++) assert.equal(e.hud.ensureConnected(), false);
  assert.equal(appends, 1, 'the mutation caused by reattachment cannot produce an append loop');
  assert.equal(e.document.querySelectorAll('#x-focus-hud').length, 1);
  assert.equal(e.document.querySelector('main').textContent, 'New X page');
  assert.deepEqual(plain(e.state()), saved);
  e.q('.mini-expand').click(); await tick();
  assert.equal(e.state().hudPreferences.mode, 'full', 'the preserved mini control remains usable');
  assert.equal(e.lifecycle.observers, 1);
  assert.equal(e.lifecycle.intervals, 1);
  e.hud.destroy();
});

test('reveal always returns to full quests view, resets scrolling and never toggles closed', async () => {
  const e = setup(), saved = plain(e.state().days), focused = [];
  e.q('.view-nav [data-view="quests"]').focus = options => focused.push(options);
  await e.hud.reveal();
  assert.equal(e.state().hudPreferences.mode, 'full');
  assert.equal(e.q('.hud').classList.contains('mini'), false);
  assert.deepEqual(e.preferences().map(message => message.preferences), [{ mode: 'full' }]);
  for (const view of ['settings', 'inventory-panel', 'assessment-panel']) {
    e.q(`.view-nav [data-view="${view}"]`).click();
    assert.equal(e.q('.card').dataset.view, view);
    e.q('.card').scrollTop = 500;
    await e.hud.reveal();
    assert.equal(e.q('.card').dataset.view, 'quests');
    assert.equal(e.q('.card').scrollTop, 0);
    assert.equal(e.q('.panel-toolbar').hidden, true);
    assert.equal(e.q('.view-nav [data-view="quests"]').getAttribute('aria-pressed'), 'true');
    assert.equal(e.q('.' + view).hidden, true);
    assert.equal(e.q('.hud').classList.contains('mini'), false);
  }
  assert.equal(e.preferences().length, 1, 'repeated reveals do not persist redundant mode changes');
  assert.equal(focused.length, 4);
  for (const value of focused) assert.equal(value.preventScroll, true);
  assert.deepEqual(plain(e.state().days), saved);
  e.hud.destroy();
});

test('reveal recovers an offscreen HUD and clamps it after viewport changes without rewriting saved position', async () => {
  const state = initialState(); state.hudPreferences = { mode: 'full', position: { anchor: 'free', x: 1, y: 1 } };
  const e = setup(state), saved = plain(e.state().hudPreferences), host = e.document.getElementById('x-focus-hud');
  e.q('.hud').style.left = '-9999px'; e.q('.hud').style.top = '50000px';
  e.window.innerWidth = 390; e.window.innerHeight = 500;
  host.remove();
  await e.hud.reveal();
  assert.equal(host.isConnected, true);
  assert.ok(e.rect().left >= 4 && e.rect().right <= 386);
  assert.ok(e.rect().top >= 4 && e.rect().bottom <= 496);
  await e.resize(320, 480);
  assert.ok(e.rect().left >= 4 && e.rect().right <= 316);
  assert.ok(e.rect().top >= 4 && e.rect().bottom <= 476);
  assert.deepEqual(e.state().hudPreferences, saved);
  assert.equal(e.preferences().length, 0);
  e.hud.destroy();
});

test('destroyed HUDs cannot be reattached or revealed and release their observer and interval', async () => {
  const e = setup(), host = e.document.getElementById('x-focus-hud'), saved = plain(e.state());
  e.hud.destroy();
  assert.equal(host.isConnected, false);
  assert.equal(e.hud.ensureConnected(), false);
  await e.hud.reveal();
  e.hud.update(hudSummary(initialState(), now));
  await e.resize(390, 844);
  assert.equal(e.document.getElementById('x-focus-hud'), null);
  assert.equal(e.commands.length, 0);
  assert.deepEqual(plain(e.state()), saved);
  assert.equal(e.lifecycle.disconnects, 1);
  assert.equal(e.lifecycle.clearedIntervals, 1);
});

test('small viewports can collapse an open subview and reveal quests without recursive preference changes', async () => {
  const e = setup(); await e.resize(180, 240);
  for (const view of ['settings', 'inventory-panel']) {
    await e.hud.reveal();
    e.q(`.view-nav [data-view="${view}"]`).click();
    assert.equal(e.q('.' + view).hidden, false);
    e.q('.minimize').click(); await tick();
    assert.equal(e.state().hudPreferences.mode, 'mini');
    assert.equal(e.q('.card').dataset.view, 'quests');
    assert.equal(e.q('.' + view).hidden, true);
    assert.ok(e.rect().left >= 4 && e.rect().right <= 176);
    assert.ok(e.rect().top >= 4 && e.rect().bottom <= 236);
    assert.equal(e.q('.card').style.maxHeight, '232px');
    const commands = e.preferences().length;
    for (let i = 0; i < 5; i++) e.hud.update(hudSummary(e.state(), now));
    assert.equal(e.preferences().length, commands, 'incoming mini summaries close subviews without saving again');
    assert.equal(e.q('.card').dataset.view, 'quests');
  }
  assert.deepEqual(e.preferences().map(message => message.preferences.mode), ['full', 'mini', 'full', 'mini']);
  assert.equal(hudSummary(e.state(), now).totalXp, 17);
  e.hud.destroy();
});
