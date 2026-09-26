import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { newState, reduce, validateBackup } from '../core.js';

const context = vm.createContext({ URL });
vm.runInContext(fs.readFileSync(new URL('../scanner.js', import.meta.url), 'utf8'), context);
const { scan, loggedInUsername } = context.XFocusScanner;
const started = new Date('2026-09-26T02:00:00Z');
const published = '2026-09-26T02:05:00Z';
const now = new Date('2026-09-26T02:10:00Z');
const profileTabs = '<div role="tablist"><a role="tab" aria-selected="true" href="/soap628">Posts</a><a role="tab" aria-selected="false" href="/soap628/with_replies">Replies</a></div>';
const fixture = (body, tabs = profileTabs) => parseHTML(`<nav><a data-testid="AppTabBar_Profile_Link" href="/soap628">Profile</a></nav><main>${tabs}${body}</main>`).document;
const article = (id, { user = 'soap628', date = published, body = '<div data-testid="tweetText">A newly published post</div>', context = '', views = null, before = '', after = '', url = `/${user}/status/${id}` } = {}) => `<article data-testid="tweet">${before}<div data-testid="User-Name"><a role="link" href="/${user}">${user}</a><a role="link" href="${url}"><time datetime="${date}">5m</time></a></div>${context}${body}${views === null ? '' : `<a role="link" href="/${user}/status/${id}/analytics" aria-label="${views} Views">${views}</a>`}${after}</article>`;
const scanAt = (doc, path = '/soap628') => scan(doc, 'soap628', path, now);
const initial = () => reduce(newState(), { type: 'settings', username: 'soap628', posts: 2, replies: 10 }, started);
const capture = (state, doc, path = '/soap628') => reduce(state, { type: 'capture', ...scanAt(doc, path) }, now);

test('three own posts are retained without views, but actions wait for network classification', () => {
  const doc = fixture(article('301') + article('302', { body: '<div data-testid="tweetPhoto"><img alt="Image"></div>' }) + article('303', { views: '0' }));
  const result = scanAt(doc);
  assert.deepEqual(Array.from(result.posts, p => [p.id, p.kind || null, p.views]), [['301', null, null], ['302', null, null], ['303', null, 0]]);
  let state = capture(initial(), doc);
  assert.equal(state.days['2026-09-26'].posts, 0, 'a missing reply context is never proof of an original post');
  state = reduce(state, { type: 'network', username: 'soap628', posts: JSON.parse(JSON.stringify(result.posts)).map(post => ({ ...post, kind: 'posts' })) }, now);
  assert.equal(state.days['2026-09-26'].posts, 3);
  assert.equal(state.days['2026-09-26'].auto.posts, 3);
  assert.equal(state.days['2026-09-26'].replies, 0);
});

test('DOM recovery and later network responses share IDs across scans, reloads and backup restore', () => {
  const doc = fixture(article('311') + article('312', { context: '<div>Replying to <a href="/someone">@someone</a></div>' }));
  let state = capture(initial(), doc);
  state = capture(validateBackup(JSON.parse(JSON.stringify(state))), doc);
  const networkPosts = JSON.parse(JSON.stringify(scanAt(doc).posts)).map(post => ({ ...post, kind: post.id === '311' ? 'posts' : 'replies' }));
  state = reduce(state, { type: 'network', username: 'soap628', posts: networkPosts }, now);
  state = reduce(state, { type: 'network', username: 'soap628', posts: networkPosts }, now);
  assert.equal(state.days['2026-09-26'].posts, 1);
  assert.equal(state.days['2026-09-26'].replies, 1);
  assert.equal(state.days['2026-09-26'].loggedPostIds.length, 2);
});

test('old posts, paused tracking and edited posts cannot grant recovery actions', () => {
  const context = '<div>Replying to <a href="/someone">@someone</a></div>';
  const doc = fixture(article('321', { date: '2026-09-26T01:59:59Z', context }) + article('322', { context, after: '<a href="/soap628/status/322/history">Edited</a>' }));
  assert.equal(capture(initial(), doc).days['2026-09-26'].replies, 0);
  const paused = reduce(initial(), { type: 'tracking', enabled: false }, started);
  assert.equal(capture(paused, fixture(article('323', { context }))).days['2026-09-26'].replies, 0);
});

test('an unknown Home, detail or replies-tab kind stays unknown instead of becoming an original post', () => {
  for (const route of ['/home', '/soap628/status/331', '/soap628/with_replies']) {
    const data = scanAt(fixture(article('331')), route);
    assert.equal(data.posts[0].kind, undefined, route);
    assert.equal(capture(initial(), fixture(article('331')), route).days['2026-09-26'].posts, 0, route);
  }
  for (const tabs of ['', '<a role="tab" aria-selected="true" href="/soap628/with_replies">Replies</a>', '<a role="tab" aria-selected="true" href="/someone">Posts</a>']) {
    assert.equal(scanAt(fixture(article('332'), tabs)).posts[0].kind, undefined);
  }
});

test('an explicit English or Chinese reply context recovers a reply independently of route or views', () => {
  for (const label of ['Replying to', '回复', '回复给', '回覆']) {
    const doc = fixture(article('341', { context: `<div><span>${label}</span> <a href="/someone">@someone</a></div>` }));
    const result = scanAt(doc, '/home');
    assert.equal(result.posts[0].kind, 'replies', label);
    const state = capture(initial(), doc, '/home');
    assert.equal(state.days['2026-09-26'].replies, 1, label);
    assert.equal(state.days['2026-09-26'].posts, 0, label);
  }
});

test('reply-like prose and mentions inside tweet text never classify a reply', () => {
  const doc = fixture(article('351', { body: '<div data-testid="tweetText">Replying to <a href="/someone">@someone</a> is a useful practice. 回复 @someone</div>' }));
  assert.equal(scanAt(doc).posts[0].kind, undefined);
  assert.equal(scanAt(doc, '/home').posts[0].kind, undefined);
});

test('unrecognized reply context and a grouped self-thread remain ambiguous even on the Posts tab', () => {
  const unknown = fixture(article('361', { context: '<div>Antwort an <a href="/someone">@someone</a></div>' }));
  assert.equal(scanAt(unknown).posts[0].kind, undefined);
  const thread = fixture(`<div data-testid="cellInnerDiv">${article('362')}${article('363')}</div>`);
  assert.equal(scanAt(thread).posts.every(post => post.kind === undefined), true);
  const collapsed = fixture(`<div data-testid="cellInnerDiv">${article('364')}<a href="/soap628/status/364">Show this thread</a></div>`);
  assert.equal(scanAt(collapsed).posts[0].kind, undefined);
});

test('reposts and embedded quotes never award an action and a pin cannot prove an original post', () => {
  const quote = `<div role="link"><a href="/soap628/status/374"><time datetime="${published}">5m</time></a><div data-testid="tweetText">Quoted old post</div></div>`;
  const doc = fixture(article('371', { before: '<div data-testid="socialContext">You reposted</div>' })
    + article('372', { before: '<div data-testid="socialContext">Pinned</div>' })
    + article('373', { after: quote })
    + article('375', { user: 'someone', after: quote }));
  const posts = scanAt(doc).posts;
  assert.deepEqual(Array.from(posts, post => [post.id, post.kind || null]), [['371', null], ['372', null], ['373', null]]);
  assert.equal(capture(initial(), doc).days['2026-09-26'].posts, 0);
  const noOuterTime = fixture(`<article data-testid="tweet"><div data-testid="User-Name">Someone else</div>${quote}</article>`);
  assert.equal(scanAt(noOuterTime).posts.length, 0);
});

test('hidden articles and external links cannot supply an own post; absolute X URLs can', () => {
  const doc = fixture(`<div hidden>${article('381')}</div>${article('382', { url: 'https://example.com/soap628/status/382' })}${article('383', { url: 'https://x.com/Soap628/status/383' })}`);
  assert.deepEqual(Array.from(scanAt(doc).posts, post => post.id), ['383']);
});

test('ordinary role=link timestamp anchors and external link previews do not look like embedded quotes', () => {
  const doc = fixture(article('391', { views: '12', after: '<div data-testid="card.wrapper"><div role="link"><a href="https://example.com/article">Read this article</a></div></div>' }));
  const post = scanAt(doc).posts[0];
  assert.equal(post.id, '391');
  assert.equal(post.views, 12);
  assert.equal(post.kind, undefined);
  assert.equal(capture(initial(), doc).days['2026-09-26'].posts, 0);
});

test('a sole signed-in account-switcher handle safely replaces a missing profile nav', () => {
  const doc = parseHTML('<button data-testid="SideNav_AccountSwitcher_Button"><span>Soap</span><span>@Soap628</span></button><main><a href="/someone">@someone</a></main>').document;
  assert.equal(loggedInUsername(doc), 'soap628');
  assert.equal(loggedInUsername(parseHTML('<main><span>@soap628</span><a href="/soap628">Profile</a></main>').document), null);
});

test('account fallback rejects hidden, multiple or ambiguous switchers and partial long handles', () => {
  for (const body of [
    '<button hidden data-testid="SideNav_AccountSwitcher_Button">@soap628</button>',
    '<button data-testid="SideNav_AccountSwitcher_Button">@soap628 @someone</button>',
    '<button data-testid="SideNav_AccountSwitcher_Button">@soap628</button><button data-testid="SideNav_AccountSwitcher_Button">@someone</button>',
    '<button data-testid="SideNav_AccountSwitcher_Button">@this_handle_is_longer_than_fifteen</button>'
  ]) assert.equal(loggedInUsername(parseHTML(body).document), null, body);
});
