import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ URL });
vm.runInContext(fs.readFileSync(new URL('../network-parser.js', import.meta.url), 'utf8'), context);
const parser = context.XFocusNetwork;
const ownUsername = 'soap628';
function post({ id = '20260001', username = ownUsername, replyTo, visibility = false } = {}) {
  const tweet = {
    __typename: 'Tweet', rest_id: id,
    core: { user_results: { result: { __typename: 'User', core: { screen_name: username }, is_blue_verified: true } } },
    legacy: { created_at: 'Sat Sep 26 02:05:00 +0000 2026', full_text: 'Published successfully',
      ...(replyTo ? { in_reply_to_status_id_str: replyTo } : {}) }
  };
  // Newly published posts may have no views object or counters yet.
  return visibility ? { __typename: 'TweetWithVisibilityResults', tweet } : tweet;
}
const mutation = (root, result) => ({ data: { [root]: { tweet_results: { result } } } });

test('long-post mutation accepts X notetweet_create root for both Note operations', () => {
  // Response path used by twikit's create_tweet(is_note_tweet=True):
  // https://github.com/d60/twikit/blob/main/twikit/client/client.py
  for (const operation of ['CreateNoteTweet', 'CreateNoteTweetV2']) {
    const result = post();
    result.note_tweet = { note_tweet_results: { result: { text: 'The complete long post' } } };
    const parsed = parser.parse(mutation('notetweet_create', result), operation, ownUsername);
    assert.equal(parsed.posts.length, 1);
    assert.equal(parsed.createdIds[0], result.rest_id);
    assert.equal(parsed.posts[0].text, 'The complete long post');
    assert.equal(parsed.posts[0].kind, 'posts');
    assert.equal(parsed.posts[0].views, null);
  }
});

test('modern user core, real X timestamp and missing views do not prevent ordinary publish detection', () => {
  const parsed = parser.parse(mutation('create_tweet', post()), 'CreateTweet', ownUsername);
  assert.equal(parsed.posts.length, 1);
  assert.equal(parsed.posts[0].createdAt, '2026-09-26T02:05:00.000Z');
  assert.equal(parsed.posts[0].views, null);
  assert.equal(parsed.blueVerified, true);
});

test('note reply retains reply classification through the visibility wrapper', () => {
  const parsed = parser.parse(mutation('notetweet_create', post({ replyTo: '20259999', visibility: true })), 'CreateNoteTweet', ownUsername);
  assert.equal(parsed.posts.length, 1);
  assert.equal(parsed.posts[0].kind, 'replies');
  assert.equal(parsed.createdIds.length, 1);
});

test('note mutation never counts quoted posts, another author, edits or unsuccessful responses', () => {
  const result = post();
  result.quoted_status_result = { result: post({ id: '20260002' }) };
  const success = mutation('notetweet_create', result);
  assert.equal(parser.parse(success, 'CreateNoteTweet', ownUsername).posts.length, 1);
  assert.equal(parser.parse(mutation('notetweet_create', post({ username: 'another' })), 'CreateNoteTweet', ownUsername).posts.length, 0);
  assert.equal(parser.parse({ ...success, errors: [{ message: 'Not published' }] }, 'CreateNoteTweet', ownUsername).posts.length, 0);
  assert.equal(parser.parse(mutation('notetweet_create', { quoted_status_result: { result } }), 'CreateNoteTweet', ownUsername).posts.length, 0);
  result.edit_control = { edit_tweet_ids: ['20250000', result.rest_id] };
  assert.equal(parser.parse(success, 'CreateNoteTweet', ownUsername).posts.length, 0);
});

test('each publish operation uses its own mutation roots and deduplicates root aliases', () => {
  const payload = mutation('notetweet_create', post());
  assert.equal(parser.parse(payload, 'CreateTweet', ownUsername).createdIds.length, 0);
  assert.equal(parser.parse(mutation('create_tweet', post()), 'CreateNoteTweet', ownUsername).createdIds.length, 0);
  payload.data.create_note_tweet = payload.data.notetweet_create;
  const parsed = parser.parse(payload, 'CreateNoteTweet', ownUsername);
  assert.equal(parsed.posts.length, 1);
  assert.equal(parsed.createdIds.length, 1);
});

test('observed single-post lookup can recover own posts without reporting a new mutation', () => {
  assert.equal(parser.operation('https://x.com/i/api/graphql/current-id/TweetResultByRestId?variables=%7B%7D'), 'TweetResultByRestId');
  const payload = { data: { tweetResult: { result: post({ visibility: true }) } } };
  const parsed = parser.parse(payload, 'TweetResultByRestId', ownUsername);
  assert.equal(parsed.posts.length, 1);
  assert.equal(parsed.createdIds.length, 0);
  assert.equal(parser.parse(payload, 'TweetResultByRestId', 'another').posts.length, 0);
});

test('endpoint matching still excludes lookalikes and unrelated or scheduled operations', () => {
  for (const url of [
    'https://x.com.evil.test/i/api/graphql/hash/CreateNoteTweet',
    'https://evil.test/i/api/graphql/hash/TweetResultByRestId',
    '/i/api/graphql/hash/CreateScheduledTweet',
    '/i/api/graphql/hash/DmConversation',
    '/i/api/graphql/hash/CreateTweet/unrelated'
  ]) assert.equal(parser.operation(url), null);
});

test('initial publish buffering exposes only a sanitized, explicitly authored mutation result', () => {
  const result = post({ username: 'Soap628' });
  result.extra_private_field = 'must-not-escape';
  result.quoted_status_result = { result: post({ id: '20260002', username: 'another' }) };
  const payload = { ...mutation('create_tweet', result), unrelated: 'must-not-escape' };
  const parsed = parser.parsePublished(payload, 'CreateTweet');
  assert.equal(parsed.username, ownUsername);
  assert.equal(parsed.posts.length, 1);
  assert.equal(parsed.posts[0].id, '20260001');
  assert.equal(parsed.createdIds.length, 1);
  assert.equal(JSON.stringify(parsed).includes('must-not-escape'), false);
  assert.equal(JSON.stringify(parsed).includes('another'), false);
  assert.equal(parser.parsePublished(mutation('notetweet_create', post()), 'CreateNoteTweet').posts.length, 1);
});

test('initial publish buffering rejects timelines, errors, missing author, ambiguous authors and edits', () => {
  const payload = mutation('create_tweet', post());
  for (const op of ['UserTweets', 'TweetResultByRestId', 'CreateScheduledTweet', 'toString']) {
    assert.equal(parser.parsePublished(payload, op), null);
  }
  assert.equal(parser.parsePublished({ ...payload, errors: [{ message: 'Failed' }] }, 'CreateTweet'), null);
  assert.equal(parser.parsePublished(mutation('create_tweet', { quoted_status_result: { result: post() } }), 'CreateTweet'), null);
  const ambiguous = mutation('notetweet_create', post());
  ambiguous.data.create_note_tweet = mutation('create_note_tweet', post({ username: 'another' })).data.create_note_tweet;
  assert.equal(parser.parsePublished(ambiguous, 'CreateNoteTweet'), null);
  payload.data.create_tweet.tweet_results.result.edit_control = { edit_tweet_ids: ['old', '20260001'] };
  assert.equal(parser.parsePublished(payload, 'CreateTweet'), null);
});
