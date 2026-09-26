import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
const context = vm.createContext({ URL });
vm.runInContext(fs.readFileSync(new URL('../scanner.js', import.meta.url), 'utf8'), context);
const { scan } = context.XFocusScanner;
const { scanAnalytics, loggedInUsername } = context.XFocusScanner;
const post = (user, id, views, extra = '') => `<article data-testid="tweet"><a href="/${user}/status/${id}"><time datetime="2026-09-26T01:00:00Z"></time></a><div data-testid="tweetText">${user} 的帖子</div><a href="/${user}/status/${id}/analytics" aria-label="${views} Views">${views}</a>${extra}</article>`;
test('reads the bound profile total, excluding following and verified-only counts', () => {
  const { document } = parseHTML('<main><a href="/soap628/following">888 Following</a><a href="/soap628/followers"><span title="1,234">1.2K</span> Followers</a><a href="/soap628/verified_followers">60 Verified followers</a><a href="/someone/followers">9999 Followers</a></main>');
  const result = scan(document, 'soap628', '/soap628');
  assert.equal(result.followers.value, 1234); assert.equal(result.followers.approximate, false);
  assert.equal(scan(document, 'soap628', '/someone').followers, null);
  assert.equal(scan(document, 'soap628', '/soap628/status/123').followers, null);
});
test('collects only own outer posts and leaves missing view counts unknown', () => {
  const quote = '<div><a href="/soap628/status/333"><time datetime="2026-09-26T01:00:00Z"></time></a><a href="/soap628/status/333/analytics">123 Views</a></div>';
  const { document } = parseHTML(`<main>${post('soap628', '111', '1.5K')}${post('someone', '222', '999', quote)}${post('soap628', '444', 'Views')}${post('soap628', '555', '0')}</main>`);
  const result = scan(document, 'soap628', '/home');
  assert.equal(result.posts.length, 2); assert.equal(result.posts[0].id, '111'); assert.equal(result.posts[0].views, 1500); assert.equal(result.posts[0].approximate, true); assert.equal(result.posts[1].views, 0);
});
test('follower links inside a post cannot contaminate the profile total', () => {
  const { document } = parseHTML('<main><article><a href="/soap628/followers">9999 Followers</a></article></main>');
  assert.equal(scan(document, 'soap628', '/soap628').followers, null);
});
const analyticsDoc = body => parseHTML(`<nav><a data-testid="AppTabBar_Profile_Link" href="/soap628">Profile</a></nav><main>${body}</main>`).document;
test('account identity comes from the logged-in profile nav, never the viewed profile', () => {
  assert.equal(loggedInUsername(analyticsDoc('')), 'soap628');
  assert.equal(loggedInUsername(parseHTML('<main><a href="/someone">Profile</a></main>').document), null);
});
test('analytics ignores a seven-day total and unselected Today button', () => {
  const document = analyticsDoc('<button aria-selected="true">7D</button><button>Today</button><section><h2>Impressions</h2><strong>12,345</strong></section>');
  assert.equal(scanAnalytics(document, 'soap628', '/i/account_analytics').length, 0);
});
test('analytics reads a single Today impression card only for the logged-in account', () => {
  const document = analyticsDoc('<button aria-selected="true">Today</button><section><h2>Impressions</h2><strong>1,234</strong></section>');
  const data = scanAnalytics(document, 'soap628', '/i/account_analytics', new Date('2026-09-26T02:00:00Z'));
  assert.equal(data.length, 1); assert.equal(data[0].date, '2026-09-26'); assert.equal(data[0].value, 1234);
  assert.equal(scanAnalytics(document, 'someone', '/i/account_analytics').length, 0);
});
test('analytics dated rows are kept per day rather than summed into today', () => {
  const document = analyticsDoc('<table><tr><th>日期</th><th>展示次数</th></tr><tr><td>2026-09-24</td><td>800</td></tr><tr><td>2026-09-25</td><td>900</td></tr></table>');
  const data = scanAnalytics(document, 'soap628', '/i/account_analytics', new Date('2026-09-26T02:00:00Z'));
  assert.equal(data.length, 2); assert.equal(data[0].value, 800); assert.equal(data[1].date, '2026-09-25');
});
