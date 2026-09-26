import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { newState, reduce } from '../core.js';
import { assessAccount } from '../assessment.js';

test('content saves a confirmed toast without a network hook, then deduplicates a later network result', async () => {
  let clock = Date.parse('2026-09-26T02:00:00Z'), mutate;
  const { document, window: domWindow } = parseHTML('<html><body><main><section><div contenteditable="true" data-testid="tweetTextarea_0">Private draft</div><button data-testid="tweetButtonInline">Post</button></section></main></body></html>');
  document.readyState = 'complete'; document.visibilityState = 'visible';
  const window = new EventTarget(), messages = [];
  let state = reduce(newState(), { type: 'settings', username: 'soap628', posts: 3, replies: 10 }, new Date(clock - 60000));
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  const context = vm.createContext({ window, document, URL, CustomEvent, Date: ClockDate, location: { pathname: '/home' },
    MutationObserver: class { constructor(callback) { mutate = callback; } observe() {} },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
    XFocusScanner: { loggedInUsername: () => 'soap628', scan: () => ({ posts: [], analytics: [] }) },
    chrome: { runtime: { id: 'test', onMessage: { addListener() {} }, async sendMessage(message) {
      messages.push(message);
      if (message.type === 'capture') state = reduce(state, message, new Date(clock));
      return { ok: true, config: { username: 'soap628', enabled: true, startedAt: state.tracking.startedAt } };
    } } }
  });
  for (const file of ['publish-confirmation.js', 'content.js']) vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  document.querySelector('button').dispatchEvent(new domWindow.Event('click', { bubbles: true }));
  assert.equal(state.days['2026-09-26'].posts, 0);
  clock += 1000;
  const id = (((BigInt(clock) - 1288834974657n) << 22n) + 1n).toString();
  const toast = document.createElement('div'); toast.setAttribute('role', 'alert');
  toast.innerHTML = `Your post was sent. <a href="/soap628/status/${id}">View</a>`;
  document.body.append(toast); mutate();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.days['2026-09-26'].posts, 1);
  assert.equal(assessAccount(state, new Date(clock)).totalXp, 5);
  const captured = messages.find(message => message.type === 'capture');
  assert.equal(captured.posts[0].id, id);
  assert.doesNotMatch(JSON.stringify(captured), /Private draft/);
  state = reduce(state, { ...captured, type: 'network' }, new Date(clock));
  mutate(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.days['2026-09-26'].posts, 1);
});
