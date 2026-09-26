import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { newState, reduce } from '../core.js';
const parserSource = fs.readFileSync(new URL('../network-parser.js', import.meta.url), 'utf8');
const observerSource = fs.readFileSync(new URL('../page-observer.js', import.meta.url), 'utf8');
const endpoint = 'https://x.com/i/api/graphql/hash/CreateTweet';
const payload = { data: { create_tweet: { tweet_results: { result: { __typename: 'Tweet', rest_id: '123', core: { user_results: { result: { legacy: { screen_name: 'soap628' } } } }, legacy: { full_text: 'hello', created_at: '2026-09-26T02:00:00Z' }, views: { count: '0' } } } } } };
function environment({ status = 200, body = JSON.stringify(payload) } = {}) {
  const window = new EventTarget(); const packets = []; const calls = [];
  window.fetch = (...args) => { calls.push(args); return Promise.resolve(new Response(body, { status })); };
  class XHR extends EventTarget { open(...args) { this.args = args; } send(...args) { this.sent = args; this.status = status; this.responseType = ''; this.responseText = body; this.dispatchEvent(new Event('load')); } }
  window.addEventListener('x-focus-data-v2', event => { const p = JSON.parse(event.detail); if (!p.ready && !p.hello) packets.push(p); });
  const ctx = vm.createContext({ window, URL, XMLHttpRequest: XHR, CustomEvent, crypto: webcrypto });
  vm.runInContext(parserSource, ctx); vm.runInContext(observerSource, ctx);
  const configure = value => window.dispatchEvent(new CustomEvent('x-focus-config-v2', { detail: JSON.stringify(value) }));
  configure({ username: 'soap628', enabled: true });
  return { window, packets, calls, XHR, configure, context: ctx };
}
const settle = async packets => { for (let i = 0; i < 30 && !packets.length; i++) await new Promise(resolve => setTimeout(resolve, 5)); };
test('fetch observation preserves the original request and readable response while emitting only sanitized fields', async () => {
  const e = environment(); const init = { method: 'POST', body: 'private request body', headers: { authorization: 'not-to-be-exported' } };
  const response = await e.window.fetch(endpoint, init);
  assert.deepEqual(await response.json(), payload);
  await settle(e.packets);
  assert.equal(e.calls.length, 1); assert.equal(e.calls[0][1], init);
  assert.equal(e.packets[0].posts[0].id, '123');
  assert.ok(!JSON.stringify(e.packets).includes('not-to-be-exported'));
  assert.ok(!JSON.stringify(e.packets).includes('private request body'));
  const packetId = e.packets[0].packetId;
  e.configure({ ack: packetId }); e.configure({ username: 'soap628', enabled: true });
  assert.equal(e.packets.length, 1, 'acknowledged packets do not replay');
});
test('failed HTTP responses, unrelated requests and paused observers produce no data', async () => {
  const failed = environment({ status: 403 }); await failed.window.fetch(endpoint); await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(failed.packets.length, 0);
  const unrelated = environment(); await unrelated.window.fetch('https://x.com/i/api/graphql/hash/DmConversation'); await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(unrelated.packets.length, 0);
  unrelated.configure({ username: 'soap628', enabled: false }); await unrelated.window.fetch(endpoint); await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(unrelated.packets.length, 0);
});
test('XHR observation keeps send arguments intact and supports post success', () => {
  const e = environment(); const xhr = new e.XHR(); xhr.open('POST', endpoint, true); xhr.send('unchanged payload');
  assert.deepEqual(xhr.sent, ['unchanged payload']); assert.equal(e.packets.length, 1); assert.equal(e.packets[0].posts[0].id, '123');
});
test('observed publishing flows through the content bridge into a single persisted count', async () => {
  const current = new Date();
  let notify, networkMessages = 0;
  let state = reduce(newState(), { type: 'settings', username: 'soap628', posts: 2, replies: 10 }, new Date(current.getTime() - 60000));
  const livePayload = structuredClone(payload); livePayload.data.create_tweet.tweet_results.result.legacy.created_at = current.toISOString();
  const e = environment({ body: JSON.stringify(livePayload) });
  const document = new EventTarget(); document.visibilityState = 'visible';
  Object.assign(e.context, { document, location: { pathname: '/home' }, XFocusScanner: { loggedInUsername: () => 'soap628' }, MutationObserver: class { observe() {} }, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
    chrome: { runtime: { id: 'test', onMessage: { addListener(callback) { notify = callback; } }, async sendMessage(message) {
      if (message.type !== 'config') state = reduce(state, message, current);
      const config = { username: state.settings.username, enabled: state.tracking.enabled, startedAt: state.tracking.startedAt };
      if (message.type === 'network') {
        networkMessages++;
        // A background broadcast can replay the unacknowledged packet during sendMessage.
        // The content bridge must suppress it until the original message is acknowledged.
        notify({ type: 'config', config }, {}, () => {});
      }
      return { ok: true, config };
    } } }
  });
  vm.runInContext(fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8'), e.context);
  await e.window.fetch(endpoint); await settle(e.packets); await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(Object.values(state.days)[0].posts, 1);
  assert.equal(networkMessages, 1, 'config/ready/replay handshakes do not recursively record a packet');
  await e.window.fetch(endpoint); await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(Object.values(state.days)[0].posts, 1);
  assert.equal(networkMessages, 2, 'each observed response creates one background message');
});
