import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const parserSource = fs.readFileSync(new URL('../network-parser.js', import.meta.url), 'utf8');
const observerSource = fs.readFileSync(new URL('../page-observer.js', import.meta.url), 'utf8');
const endpoint = 'https://x.com/i/api/graphql/hash/CreateTweet';
const settled = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function payload(username = 'soap628', id = '123') {
  return { secretResponseField: 'not-for-storage', data: { create_tweet: { tweet_results: { result: {
    __typename: 'Tweet', rest_id: id,
    core: { user_results: { result: { legacy: { screen_name: username, followers_count: 120 } } } },
    legacy: { created_at: new Date().toISOString(), full_text: 'A confirmed post' }
  } } } } };
}
function environment() {
  const window = new EventTarget(), packets = [], handshakes = [], requests = [], timers = new Map();
  let sequence = 0;
  window.fetch = (...args) => { const task = deferred(); requests.push({ ...task, args }); return task.promise; };
  class XHR extends EventTarget {
    open(...args) { this.openArgs = args; }
    send(...args) { this.sendArgs = args; }
    finish(body = payload()) { this.status = 200; this.responseType = ''; this.responseText = JSON.stringify(body); this.dispatchEvent(new Event('load')); }
  }
  window.addEventListener('x-focus-data-v2', event => {
    const item = JSON.parse(event.detail);
    if (item.ready) handshakes.push(item);
    else if (!item.hello) packets.push(item);
  });
  const context = vm.createContext({ window, URL, XMLHttpRequest: XHR, CustomEvent, crypto: webcrypto,
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(parserSource, context);
  vm.runInContext(observerSource, context);
  const configure = value => window.dispatchEvent(new CustomEvent('x-focus-config-v2', { detail: JSON.stringify(value) }));
  return { window, packets, handshakes, requests, timers, XHR, configure,
    async respond(index = requests.length - 1, body = payload()) {
      requests[index].resolve({ ok: true, clone: () => ({ text: () => Promise.resolve(JSON.stringify(body)) }) });
      await settled();
    },
    async delayedBody(index = requests.length - 1) {
      const body = deferred();
      requests[index].resolve({ ok: true, clone: () => ({ text: () => body.promise }) });
      await settled();
      return body;
    },
    runTimer(delay) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `a retry is scheduled for ${delay} ms`);
      timers.delete(entry[0]); entry[1].callback();
    }
  };
}
const active = { username: 'soap628', enabled: true };

test('startup publish waits for identity and releases only a sanitized matching result', async () => {
  const e = environment();
  e.window.fetch(endpoint, { body: 'private-request', headers: { authorization: 'private-token' } });
  await e.respond();
  assert.equal(e.packets.length, 0);
  e.configure({ username: '', enabled: false, bufferUntilIdentity: true });
  assert.equal(e.packets.length, 0);
  e.configure(active);
  assert.equal(e.packets.length, 1);
  assert.equal(e.packets[0].posts[0].id, '123');
  assert.doesNotMatch(JSON.stringify(e.packets), /private-request|private-token|not-for-storage/);
});

test('identity may resolve while the publish response clone is still being read', async () => {
  const e = environment(); e.window.fetch(endpoint);
  const body = await e.delayedBody();
  e.configure(active);
  body.resolve(JSON.stringify(payload())); await settled();
  assert.equal(e.packets.length, 1);
  assert.equal(e.packets[0].username, 'soap628');
});

test('identity buffering does not retain timelines or another account\'s published data', async () => {
  const e = environment();
  e.window.fetch('https://x.com/i/api/graphql/hash/HomeTimeline'); await e.respond();
  e.window.fetch(endpoint); await e.respond(1, payload('other_account'));
  e.configure({ ...active, enabled: false, bufferUntilIdentity: true });
  e.configure(active);
  assert.equal(e.packets.length, 0);
  assert.equal(e.timers.size, 0);
});

test('explicit pause clears a startup result and prevents a paused request being counted after resume', async () => {
  const e = environment(); e.window.fetch(endpoint); await e.respond();
  e.configure({ ...active, enabled: false });
  e.window.fetch(endpoint);
  e.configure(active);
  await e.respond(1);
  assert.equal(e.packets.length, 0);
  assert.equal(e.timers.size, 0);
});

test('pause during response clone cancels in-flight capture even after resuming', async () => {
  const e = environment(); e.configure(active); e.window.fetch(endpoint);
  const body = await e.delayedBody();
  e.configure({ ...active, enabled: false }); e.configure(active);
  body.resolve(JSON.stringify(payload())); await settled();
  assert.equal(e.packets.length, 0);
});

test('rebinding during an in-flight request cannot attribute its response to the new account', async () => {
  const e = environment(); e.configure(active); e.window.fetch(endpoint);
  const body = await e.delayedBody();
  e.configure({ username: 'other_account', enabled: true });
  body.resolve(JSON.stringify(payload('other_account'))); await settled();
  assert.equal(e.packets.length, 0);
});

test('a temporary missing identity preserves confirmed own publishes until identity returns', async () => {
  const e = environment(); e.configure(active); e.window.fetch(endpoint);
  e.configure({ ...active, enabled: false, bufferUntilIdentity: true });
  await e.respond();
  assert.equal(e.packets.length, 0);
  e.configure(active);
  assert.equal(e.packets.length, 1);
});

test('unacknowledged packets retry with the same id and stop immediately on acknowledgement', async () => {
  const e = environment(); e.configure(active); e.window.fetch(endpoint); await e.respond();
  const id = e.packets[0].packetId;
  e.runTimer(2000); e.runTimer(5000);
  assert.equal(e.packets.length, 3);
  assert.ok(e.packets.every(packet => packet.packetId === id));
  e.configure({ ack: id });
  assert.equal(e.timers.size, 0);
  e.configure(active);
  assert.equal(e.packets.length, 3);
});

test('automatic retry is bounded and a later handshake can retry a transient storage failure', async () => {
  const e = environment(); e.configure(active); e.window.fetch(endpoint); await e.respond();
  e.runTimer(2000); e.runTimer(5000); e.runTimer(10000);
  assert.equal(e.packets.length, 4);
  assert.equal(e.timers.size, 0);
  e.configure(active);
  assert.equal(e.packets.length, 5);
  assert.equal(e.timers.size, 1);
});

test('replay delivers every queued publish when acknowledgements are synchronous', async () => {
  const e = environment();
  for (let i = 0; i < 3; i++) { e.window.fetch(endpoint); await e.respond(i, payload('soap628', String(100 + i))); }
  e.window.addEventListener('x-focus-data-v2', event => {
    const packet = JSON.parse(event.detail);
    if (packet.packetId) e.configure({ ack: packet.packetId });
  });
  e.configure(active);
  assert.deepEqual(e.packets.map(packet => packet.posts[0].id), ['100', '101', '102']);
  assert.equal(e.timers.size, 0);
});

test('handshakes report replaced transports without replacing another script\'s implementation', () => {
  const e = environment(); e.configure(active);
  assert.deepEqual(e.handshakes.at(-1).transport, { fetch: true, xhr: true });
  const replacement = () => Promise.resolve(); e.window.fetch = replacement;
  e.XHR.prototype.send = function replacementSend() {};
  e.configure(active);
  assert.deepEqual(e.handshakes.at(-1).transport, { fetch: false, xhr: false });
  assert.equal(e.window.fetch, replacement);
});

test('reopening an XHR removes an aborted request\'s listener and keeps only its latest success', () => {
  const e = environment(); e.configure(active);
  const xhr = new e.XHR();
  xhr.open('POST', endpoint); xhr.send('first-request');
  xhr.open('POST', endpoint); xhr.send('second-request'); xhr.finish();
  assert.equal(e.packets.length, 1);
  assert.deepEqual(xhr.sendArgs, ['second-request']);
});

test('XHR supports identity-delayed success and does not count a paused send after resuming', () => {
  const e = environment(), first = new e.XHR();
  first.open('POST', endpoint); first.send('unchanged'); first.finish();
  assert.equal(e.packets.length, 0);
  e.configure(active); assert.equal(e.packets.length, 1);
  e.configure({ ack: e.packets[0].packetId });
  e.configure({ ...active, enabled: false });
  const second = new e.XHR(); second.open('POST', endpoint); second.send('unchanged');
  e.configure(active); second.finish();
  assert.equal(e.packets.length, 1);
});
