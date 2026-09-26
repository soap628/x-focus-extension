import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { newState, reduce, upgradeState, validateBackup } from '../core.js';
const clock = new Date('2026-09-26T02:00:00Z');
const later = new Date('2026-09-26T02:05:00Z');
const context = vm.createContext({ URL });
vm.runInContext(fs.readFileSync(new URL('../network-parser.js', import.meta.url), 'utf8'), context);
const parser = context.XFocusNetwork;
function rawTweet(id = '101', extra = {}) {
  return { __typename: 'Tweet', rest_id: id, core: { user_results: { result: { __typename: 'User', legacy: { screen_name: 'soap628', followers_count: 500 } } } }, legacy: { created_at: later.toISOString(), full_text: 'My post', ...extra }, views: { count: '12' } };
}
function start() { return reduce(newState(), { type: 'settings', username: 'soap628', posts: 2, replies: 10 }, clock); }
const sample = (overrides = {}) => ({ id: '101', kind: 'posts', createdAt: later.toISOString(), text: 'A post', views: 10, approximate: false, ...overrides });
const network = (posts, extra = {}) => ({ type: 'network', username: 'soap628', posts, ...extra });
test('network parser accepts only observed X operations, never other sites or DMs', () => {
  assert.equal(parser.operation('https://x.com/i/api/graphql/hash/CreateTweet'), 'CreateTweet');
  assert.equal(parser.operation('/i/api/graphql/hash/UserTweetsAndReplies'), 'UserTweetsAndReplies');
  for (const url of ['https://evil.test/i/api/graphql/hash/CreateTweet', 'https://x.com/i/api/graphql/hash/DmConversation', '/i/api/graphql/hash/CreateScheduledTweet']) assert.equal(parser.operation(url), null);
});
test('successful mutation counts the outer post, never its quoted post', () => {
  const outer = rawTweet('101', { quoted_status_result: { result: rawTweet('202') } });
  const payload = { data: { create_tweet: { tweet_results: { result: outer } } } };
  const parsed = parser.parse(payload, 'CreateTweet', 'soap628');
  assert.equal(parsed.posts.length, 1); assert.equal(parsed.posts[0].id, '101'); assert.equal(parsed.posts[0].kind, 'posts');
  assert.equal(parser.parse({ ...payload, errors: [{ message: 'Not published' }] }, 'CreateTweet', 'soap628').posts.length, 0);
  assert.equal(parser.parse(payload, 'CreateTweet', 'another').posts.length, 0);
});
test('replies and edit histories are recognized without inferring from button clicks', () => {
  const reply = rawTweet('102', { in_reply_to_status_id_str: '99' });
  const payload = { data: { create_tweet: { tweet_results: { result: reply } } } };
  assert.equal(parser.parse(payload, 'CreateTweet', 'soap628').posts[0].kind, 'replies');
  reply.edit_control = { edit_tweet_ids: ['98', '102'] };
  assert.equal(parser.parse(payload, 'CreateTweet', 'soap628').createdIds.length, 0);
  assert.equal(parser.parse({ data: { create_tweet: {} } }, 'CreateTweet', 'soap628').posts.length, 0);
});
test('timeline recursion ignores retweet and quote branches, reads exact own profile totals', () => {
  const payload = { data: { entries: [{ content: { result: rawTweet() } }, { result: rawTweet('201', { retweeted_status_result: { result: rawTweet('202') } }) }] } };
  const result = parser.parse(payload, 'UserTweets', 'soap628');
  assert.equal(result.posts.length, 1); assert.equal(result.posts[0].views, 12);
  assert.equal(result.followers.value, 500);
  const profile = { data: { user: { result: { legacy: { screen_name: 'soap628', followers_count: 501 } } } } };
  assert.equal(parser.parse(profile, 'UserByScreenName', 'soap628').followers.value, 501);
});
test('publish event, repeat event and timeline refresh add exactly one action', () => {
  let state = reduce(start(), network([sample()]), later);
  state = reduce(state, network([sample()]), later);
  assert.equal(state.days['2026-09-26'].posts, 1); assert.equal(state.days['2026-09-26'].auto.posts, 1);
  state = reduce(state, network([sample({ id: '102', kind: 'replies' })]), later);
  assert.equal(state.days['2026-09-26'].replies, 1);
  state = reduce(state, { type: 'adjust', kind: 'posts', amount: -1 }, later);
  state = reduce(state, network([sample()]), later);
  assert.equal(state.days['2026-09-26'].posts, 0, 'a manual correction is not undone by refresh');
});
test('baseline excludes pre-upgrade posts, scheduled future posts and edits', () => {
  const state = reduce(start(), network([sample({ id: '1', createdAt: '2026-09-26T01:00:00Z' }), sample({ id: '2', createdAt: '2026-09-27T01:00:00Z' }), sample({ id: '3', edited: true })]), later);
  assert.equal(state.days['2026-09-26'].posts, 0);
});
test('pause skips events and resume starts a fresh observation window', () => {
  let state = reduce(start(), { type: 'tracking', enabled: false }, clock);
  state = reduce(state, network([sample()]), later);
  assert.equal(state.days['2026-09-26'].posts, 0);
  const resume = new Date('2026-09-26T03:00:00Z');
  state = reduce(state, { type: 'tracking', enabled: true }, resume);
  state = reduce(state, network([sample()]), resume);
  assert.equal(state.days['2026-09-26'].posts, 0);
});
test('post view deltas use exact intra-day samples, missing midnight does not create fake daily exposure', () => {
  let state = reduce(start(), network([sample({ createdAt: '2026-09-24T00:00:00Z', views: 100 })]), later);
  assert.equal(state.days['2026-09-26'].trackedViews, 0);
  state = reduce(state, network([sample({ createdAt: '2026-09-24T00:00:00Z', views: 130 })]), later);
  assert.equal(state.days['2026-09-26'].trackedViews, 30);
  state = reduce(state, network([sample({ createdAt: '2026-09-24T00:00:00Z', views: 125 })]), later);
  state = reduce(state, network([sample({ createdAt: '2026-09-24T00:00:00Z', views: 132 })]), later);
  assert.equal(state.days['2026-09-26'].trackedViews, 32);
  state = reduce(state, network([sample({ createdAt: '2026-09-24T00:00:00Z', views: 180 })]), new Date('2026-09-27T02:00:00Z'));
  assert.equal(state.days['2026-09-27'].trackedViews, 0);
  assert.equal(state.days['2026-09-27'].impressions, null);
});
test('new posts can start at zero; approximate samples never inflate precise deltas', () => {
  let state = reduce(start(), network([sample({ views: 100 })]), later);
  assert.equal(state.days['2026-09-26'].trackedViews, 100);
  state = reduce(state, network([sample({ views: 1200, approximate: true })]), later);
  assert.equal(state.days['2026-09-26'].trackedViews, 100);
});
test('v1 migration and backup restore preserve manual history and automatic deduplication', () => {
  const legacy = start(); legacy.version = 1; delete legacy.tracking;
  legacy.days['2026-09-26'].posts = 3; delete legacy.days['2026-09-26'].auto;
  const migrated = upgradeState(validateBackup(legacy), clock);
  assert.equal(migrated.days['2026-09-26'].posts, 3);
  let state = reduce(migrated, network([sample()]), later);
  state = reduce(validateBackup(JSON.parse(JSON.stringify(state))), network([sample()]), later);
  assert.equal(state.days['2026-09-26'].posts, 4);
  assert.equal(state.days['2026-09-26'].loggedPostIds.length, 1);
});
test('analytics capture is a separate dated source and leaves manual corrections intact', () => {
  let state = reduce(start(), { type: 'capture', username: 'soap628', analytics: [{ date: '2026-09-26', value: 456, approximate: false }] }, later);
  assert.equal(state.days['2026-09-26'].impressions.source, 'analytics');
  state = reduce(state, { type: 'daily', date: '2026-09-26', impressions: 455, note: '' }, later);
  state = reduce(state, { type: 'capture', username: 'soap628', analytics: [{ date: '2026-09-26', value: 459 }] }, later);
  assert.equal(state.days['2026-09-26'].impressions.value, 455);
});
