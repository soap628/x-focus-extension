import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { newState, reduce, upgradeState } from '../core.js';
import { actionExperience } from '../assessment.js';

const sources = ['network-parser.js', 'page-observer.js', 'content.js']
  .map(file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const endpoint = 'https://x.com/i/api/graphql/hash/CreateTweet';
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function pipeline({ account = 'soap628', loseBindResponse = false } = {}) {
  const window = new EventTarget(), document = new EventTarget(), now = new Date();
  document.readyState = 'complete'; document.visibilityState = 'visible';
  let state = upgradeState(newState(), new Date(now.getTime() - 60000));
  let active = account, listener, interval, mutate, sequence = 0;
  let failBind = loseBindResponse, failNetwork = true;
  const timers = new Map(), calls = [], responseBodies = [];
  const config = () => ({ username: state.settings.username, enabled: state.tracking.enabled, startedAt: state.tracking.startedAt });
  window.fetch = () => {
    const body = responseBodies.shift();
    assert.ok(body, 'every observed request uses an explicit successful response fixture');
    return Promise.resolve({ ok: true, clone: () => ({ text: () => Promise.resolve(JSON.stringify(body)) }) });
  };
  class XHR extends EventTarget { open() {} send() {} }
  const context = vm.createContext({
    window, document, URL, CustomEvent, XMLHttpRequest: XHR, crypto: webcrypto, location: { pathname: '/home' },
    XFocusHUD: { mount: () => ({ update() {}, setConnection() {} }) },
    XFocusScanner: {
      loggedInUsername: () => active,
      scan: () => ({ username: config().username, posts: [], followers: null, analytics: [] })
    },
    MutationObserver: class { constructor(callback) { mutate = callback; } observe() {} },
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback) { interval = callback; },
    chrome: { runtime: {
      id: 'test', onMessage: { addListener(callback) { listener = callback; } },
      async sendMessage(message) {
        calls.push(message);
        if (message.type === 'bind') {
          state = reduce(state, message, now);
          // Storage committed successfully, but neither reply nor broadcast
          // reaches the content script. Its next regular read must recover.
          if (failBind) { failBind = false; throw new Error('Lost bind response'); }
        } else if (message.type === 'network') {
          if (failNetwork) { failNetwork = false; throw new Error('Temporary storage failure'); }
          state = reduce(state, message, now);
        } else if (message.type === 'heartbeat') state = reduce(state, message, now);
        return { ok: true, config: config() };
      }
    } }
  });
  for (const source of sources) vm.runInContext(source, context);
  return {
    calls,
    state: () => state,
    postCount: () => Object.values(state.days).reduce((sum, day) => sum + day.posts, 0),
    async publish(id) {
      responseBodies.push({ data: { create_tweet: { tweet_results: { result: {
        rest_id: id, core: { user_results: { result: { legacy: { screen_name: 'soap628' } } } },
        legacy: { created_at: now.toISOString(), full_text: 'Confirmed synthetic post' }
      } } } } });
      await window.fetch(endpoint); await settle();
    },
    identify(username) { active = username; mutate(); },
    async scan() { await new Promise(resolve => listener({ type: 'scan' }, {}, resolve)); await settle(); },
    async minute() { interval(); await settle(); },
    async retry() {
      const entry = [...timers].find(([, timer]) => timer.delay === 2000);
      assert.ok(entry, 'an unacknowledged packet schedules a 2-second retry');
      timers.delete(entry[0]); entry[1].callback(); await settle();
    }
  };
}

test('lost committed bind response recovers at the next handshake and retries one failed post save exactly once', async () => {
  const e = pipeline({ loseBindResponse: true }); await settle();
  await e.publish('777');
  assert.equal(e.postCount(), 0, 'the confirmed result waits for account binding');
  await e.scan();
  assert.equal(e.state().settings.username, 'soap628', 'binding was persisted despite its lost reply');
  assert.equal(e.postCount(), 0);
  await e.minute();
  assert.equal(e.postCount(), 0, 'the first save fails without acknowledging its packet');
  await e.retry();
  assert.equal(e.postCount(), 1);
  assert.equal(actionExperience(e.state()), 5);
  await e.minute();
  assert.equal(e.postCount(), 1);
  assert.equal(e.calls.filter(message => message.type === 'network').length, 2);
});

test('three posts made before identity resolves survive a failed save and award 15 EXP without replay duplication', async () => {
  const e = pipeline({ account: null }); await settle();
  for (const id of ['801', '802', '803']) await e.publish(id);
  assert.equal(e.postCount(), 0);
  assert.equal(e.calls.filter(message => message.type === 'network').length, 0, 'unknown identity releases no data');
  e.identify('soap628'); await e.scan();
  assert.equal(e.postCount(), 2, 'other confirmed posts save while the first awaits its retry');
  await e.retry();
  assert.equal(e.postCount(), 3);
  assert.equal(actionExperience(e.state()), 15);
  assert.deepEqual(Object.values(e.state().days).flatMap(day => day.loggedPostIds).sort(), ['801', '802', '803']);
  await e.minute();
  assert.equal(e.postCount(), 3);
  assert.equal(actionExperience(e.state()), 15);
  assert.equal(e.calls.filter(message => message.type === 'network').length, 4, 'only the failed packet is retried');
});
