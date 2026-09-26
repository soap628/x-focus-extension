import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

const source = fs.readFileSync(new URL('../publish-confirmation.js', import.meta.url), 'utf8');
const start = Date.parse('2026-09-26T02:00:00Z');
const snowflake = (at, sequence = 1) => (((BigInt(at) - 1288834974657n) << 22n) + BigInt(sequence)).toString();
const composerMarkup = (label = 'Post', suffix = 0) => `<section class="composer"><div contenteditable="true" data-testid="tweetTextarea_${suffix}" role="textbox">Draft text</div><div><button data-testid="tweetButtonInline"><span>${label}</span></button></div></section>`;
function setup({ body = composerMarkup(), handler } = {}) {
  const { document, window } = parseHTML(`<html><body><main>${body}</main></body></html>`);
  const context = vm.createContext({ URL });
  vm.runInContext(source, context);
  let clock = start, owner = 'soap628', focused = document.body;
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => focused });
  const saved = [];
  const instance = context.XFocusPublishConfirmation.mount({ document, username: () => owner, now: () => clock,
    onConfirmed: handler || (post => saved.push(JSON.parse(JSON.stringify(post)))) });
  function click(selector = '[data-testid="tweetButtonInline"]') {
    document.querySelector(selector).dispatchEvent(new window.Event('click', { bubbles: true }));
  }
  function key({ focus = true, ...properties } = {}) {
    const composer = document.querySelector('[data-testid="tweetTextarea_0"]');
    focused = focus ? composer : document.body;
    const event = new window.Event('keydown', { bubbles: true });
    Object.assign(event, { key: 'Enter', ctrlKey: true, ...properties });
    composer.dispatchEvent(event);
  }
  function toast({ id = snowflake(start + 1000), text = 'Your post was sent.', user = 'soap628', href, role = 'alert', testid = 'toast' } = {}) {
    const node = document.createElement('div');
    node.setAttribute('role', role);
    node.setAttribute('data-testid', testid);
    const message = document.createElement('span'); message.textContent = text; node.append(message);
    if (id !== null) { const link = document.createElement('a'); link.href = href || `/${user}/status/${id}`; link.textContent = 'View'; node.append(link); }
    document.body.append(node);
    return node;
  }
  return { document, saved, click, key, toast, scan: instance.scan, destroy: instance.destroy,
    advance(ms = 1000) { clock += ms; }, account(value) { owner = value; }, time(value) { clock = value; } };
}

test('a submit click alone never counts; a new own success toast confirms one original', async () => {
  const app = setup(); app.click(); await app.scan(); assert.equal(app.saved.length, 0);
  app.advance(); app.toast(); await app.scan(); await app.scan();
  assert.equal(app.saved.length, 1);
  assert.deepEqual(app.saved[0], { id: snowflake(start + 1000), kind: 'posts', createdAt: new Date(start + 1000).toISOString(), text: '', views: null, approximate: false });
  assert.equal(JSON.stringify(app.saved).includes('Draft text'), false);
});

test('reply buttons preserve the 1 EXP action kind with both generic and reply success copy', async () => {
  for (const [label, text] of [['Reply', 'Your post was sent.'], ['回复', '你的回复已发送。'], ['回覆', 'Your reply was sent.']]) {
    const app = setup({ body: composerMarkup(label) }); app.click(); app.advance(); app.toast({ text }); await app.scan();
    assert.equal(app.saved[0]?.kind, 'replies', `${label}: ${text}`);
  }
});

test('Chinese post copy and a canonical i/web/status link confirm explicit post intent', async () => {
  const app = setup({ body: composerMarkup('发布') }); app.click(); app.advance();
  app.toast({ text: '你的帖子已发送。', href: `/i/web/status/${snowflake(start + 1000)}` }); await app.scan();
  assert.equal(app.saved[0]?.kind, 'posts');
});

test('without intent, ambiguous multiple composers or unrelated controls no action is inferred', async () => {
  for (const scenario of ['no-intent', 'two-composers', 'wrong-label', 'unrelated-control', 'hidden', 'disabled']) {
    const body = scenario === 'two-composers' ? composerMarkup() + composerMarkup('Reply', 1)
      : scenario === 'wrong-label' ? composerMarkup('Post your reply')
      : scenario === 'unrelated-control' ? composerMarkup().replace('tweetButtonInline', 'someOtherButton') : composerMarkup();
    const app = setup({ body });
    if (scenario === 'hidden') app.document.querySelector('.composer').setAttribute('hidden', '');
    if (scenario === 'disabled') app.document.querySelector('button').setAttribute('aria-disabled', 'true');
    if (scenario !== 'no-intent') app.click('button');
    app.advance(); app.toast(); await app.scan(); assert.equal(app.saved.length, 0, scenario);
  }
});

test('Ctrl/Meta+Enter requires the focused single composer and its own exact submit control', async () => {
  for (const properties of [{}, { ctrlKey: false, metaKey: true }]) {
    const app = setup(); app.key(properties); app.advance(); app.toast(); await app.scan(); assert.equal(app.saved.length, 1);
  }
  for (const properties of [{ focus: false }, { ctrlKey: false }, { shiftKey: true }, { isComposing: true }, { repeat: true }]) {
    const app = setup(); app.key(properties); app.advance(); app.toast(); await app.scan(); assert.equal(app.saved.length, 0);
  }
  const app = setup({ body: `<section>${composerMarkup().replace(/<button[^>]*>.*?<\/button>/, '')}</section><aside><button data-testid="tweetButtonInline">Post</button></aside>` });
  app.key(); app.advance(); app.toast(); await app.scan(); assert.equal(app.saved.length, 0, 'a page-wide unrelated button is not the composer submit');
});

test('old toast IDs, historic IDs, future IDs and malformed IDs cannot confirm a publish', async () => {
  const baseline = setup(); baseline.toast({ id: snowflake(start + 1000) }); baseline.click(); baseline.advance(); await baseline.scan();
  assert.equal(baseline.saved.length, 0, 'an already-visible toast is not new');
  for (const id of [snowflake(start - 1), snowflake(start + 6001), '123', 'invalid', '99999999999999999999']) {
    const app = setup(); app.click(); app.advance(); app.toast({ id }); await app.scan(); assert.equal(app.saved.length, 0, id);
  }
});

test('only an exact canonical own-account or X web status URL is eligible', async () => {
  const id = snowflake(start + 1000);
  for (const href of [`/another/status/${id}`, `https://x.com.evil.test/soap628/status/${id}`, `https://example.com/soap628/status/${id}`, `/soap628/status/${id}/analytics`, `/soap628/status/${id}/photo/1`, `http://x.com/soap628/status/${id}`]) {
    const app = setup(); app.click(); app.advance(); app.toast({ href }); await app.scan(); assert.equal(app.saved.length, 0, href);
  }
  const app = setup(); app.click(); app.advance(); app.toast({ href: `https://x.com/Soap628/status/${id}` }); await app.scan(); assert.equal(app.saved.length, 1);
});

test('failed, ambiguous, linkless or incompatible success messages cannot confirm and failures clear intent', async () => {
  for (const options of [{ text: 'Something went wrong. Try again.' }, { text: 'Your post was not sent.' }, { text: '发送失败' }, { text: 'Post draft saved' }, { id: null }, { text: 'Your reply was sent.' }]) {
    const app = setup(); app.click(); app.advance(); app.toast(options); await app.scan(); assert.equal(app.saved.length, 0);
  }
  const app = setup(); app.click(); app.advance(); const failure = app.toast({ text: 'Something went wrong.' }); await app.scan(); failure.remove();
  app.toast(); await app.scan(); assert.equal(app.saved.length, 0, 'success after failure needs another submit attempt');
  const ambiguous = setup(); ambiguous.click(); ambiguous.advance(); ambiguous.toast(); ambiguous.toast({ id: snowflake(start + 1000, 2) }); await ambiguous.scan();
  assert.equal(ambiguous.saved.length, 0);
});

test('expiry, account switch, pause and destroy cancel outstanding confirmation', async () => {
  for (const action of [app => app.advance(120001), app => app.account('another'), app => app.account(''), app => app.destroy()]) {
    const app = setup(); app.click(); action(app); app.toast(); await app.scan(); assert.equal(app.saved.length, 0);
  }
  const app = setup(); app.destroy(); app.click(); app.advance(); app.toast(); await app.scan(); assert.equal(app.saved.length, 0);
});

test('saving a confirmation is single-flight and marks the ID seen only after success', async () => {
  let finish, count = 0;
  const app = setup({ handler: () => { count++; return new Promise(resolve => { finish = resolve; }); } });
  app.click(); app.advance(); app.toast(); const saving = app.scan(); await app.scan();
  assert.equal(count, 1); finish(); await saving; await app.scan(); assert.equal(count, 1);
});

test('a failed save retries the sanitized candidate even after its toast disappears', async () => {
  let count = 0;
  const app = setup({ handler: () => { count++; if (count === 1) throw new Error('storage unavailable'); } });
  app.click(); app.advance(); const toast = app.toast(); await app.scan(); toast.remove(); await app.scan(); await app.scan();
  assert.equal(count, 2);
});

test('the confirmation fallback never prevents clicks or keyboard events', () => {
  const app = setup(); let received = 0;
  app.document.addEventListener('click', event => { assert.equal(event.defaultPrevented, false); received++; });
  app.document.addEventListener('keydown', event => { assert.equal(event.defaultPrevented, false); received++; });
  app.click(); app.key(); assert.equal(received, 2);
});
