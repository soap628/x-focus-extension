import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState, reduce, validateBackup } from '../core.js';
import { initializeRewards, settleRewards } from '../rewards.js';
import { assessAccount } from '../assessment.js';

const start = new Date('2026-09-26T01:00:00Z');
const now = new Date('2026-09-26T02:00:00Z');
const date = '2026-09-26';
const setup = () => initializeRewards(reduce(newState(), { type: 'settings', username: 'soap628', posts: 3, replies: 1 }, start), start);
const post = (id, kind = 'posts', extra = {}) => ({ id, kind, createdAt: now.toISOString(), text: 'observed own post', views: null, ...extra });
const capture = (posts, type = 'capture') => ({ type, username: 'soap628', posts });
const dispatch = (state, action, at = now) => settleRewards(state, reduce(state, action, at), action, at);

test('three missing posts recover from the page with no view counters, once across both sources and restart', () => {
  const posts = ['1001', '1002', '1003'].map(id => post(id));
  let state = dispatch(setup(), capture(posts));
  assert.equal(state.days[date].posts, 3);
  assert.equal(state.days[date].auto.posts, 3);
  assert.equal(assessAccount(state, now).totalXp, 15);
  assert.equal(state.tracking.lastPageAt, now.toISOString());
  state = validateBackup(JSON.parse(JSON.stringify(state)));
  state = dispatch(state, capture(posts, 'network'));
  state = dispatch(state, capture(posts));
  assert.equal(state.days[date].posts, 3);
  assert.equal(state.days[date].loggedPostIds.length, 3);
  assert.equal(assessAccount(state, now).totalXp, 15);
});

test('unclassified DOM samples, edits, old and future posts never create actions', () => {
  const inputs = [post('1001', undefined), post('1002', 'replies', { edited: true }),
    post('1003', 'posts', { createdAt: '2026-09-26T00:59:00Z' }),
    post('1004', 'posts', { createdAt: '2026-09-26T03:00:00Z' }), null];
  delete inputs[0].kind;
  const state = dispatch(setup(), capture(inputs));
  assert.equal(state.days[date].posts, 0);
  assert.equal(state.days[date].replies, 0);
  assert.equal(assessAccount(state, now).totalXp, 0);
  assert.equal(Object.keys(state.posts).length, 3, 'valid metric-only samples remain available');
});

test('paused capture cannot bypass the counter gate; resume excludes the paused interval', () => {
  let state = dispatch(setup(), { type: 'tracking', enabled: false });
  state = dispatch(state, capture([post('1001')]));
  assert.equal(state.days[date].posts, 0);
  const resume = new Date('2026-09-26T03:00:00Z');
  state = dispatch(state, { type: 'tracking', enabled: true }, resume);
  state = dispatch(state, capture([post('1001')]), resume);
  assert.equal(state.days[date].posts, 0);
});

test('page recovery respects explicit corrections and can complete a single daily chest', () => {
  let state = dispatch(setup(), capture(['1001', '1002', '1003'].map(id => post(id))));
  state = dispatch(state, capture([post('1004', 'replies')]));
  assert.equal(assessAccount(state, now).totalXp, 16);
  assert.equal(state.rewards.earned.filter(e => e.reason === 'daily').length, 1);
  state = dispatch(state, { type: 'adjust', kind: 'posts', amount: -1 });
  state = dispatch(state, capture(['1001', '1002', '1003'].map(id => post(id)), 'network'));
  assert.equal(state.days[date].posts, 2);
  assert.equal(state.rewards.earned.filter(e => e.reason === 'daily').length, 1);
});

test('recovered actions can cross a level milestone; duplicate data cannot award it twice', () => {
  let state = dispatch(setup(), { type: 'daily', date, posts: 79, replies: 4, note: '' });
  assert.equal(assessAccount(state, now).level, 4);
  state = dispatch(state, capture([post('2001', 'replies')]));
  assert.equal(assessAccount(state, now).level, 5);
  state = dispatch(state, capture([post('2001', 'replies')], 'network'));
  assert.equal(state.rewards.earned.filter(e => e.id === 'level:5').length, 1);
});
