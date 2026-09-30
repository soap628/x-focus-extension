import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

const context = vm.createContext({ URL });
vm.runInContext(fs.readFileSync(new URL('../scanner.js', import.meta.url), 'utf8'), context);
const { scan } = context.XFocusScanner;
const now = new Date('2026-10-01T04:00:00Z');
const route = '/i/account_analytics';
const documentFor = (body, period = '7D') => parseHTML(`<html><body><nav><a data-testid="AppTabBar_Profile_Link" href="/soap628">Profile</a></nav><main><button aria-selected="true">${period}</button>${body}</main></body></html>`).document;
const card = (label, value) => `<section><div class="label">${label}</div><div class="value">${value}</div></section>`;
const wrap = (markup, count) => '<div>'.repeat(count) + markup + '</div>'.repeat(count);
const read = (body, period) => scan(documentFor(body, period), 'soap628', route, now);

test('English labels and SVG comparison values survive nested React-style wrappers', () => {
  // Constructed fixtures exercise DOM shapes; they are not a captured X page.
  const result = read(card('<span>Checkmark</span><span>followers</span>', wrap('<span>2.2K</span><span> / </span><span>3K</span>', 3))
    + card('<span>Impressions</span>', wrap('<span>93.4K</span><div><svg aria-hidden="true"><path/></svg><span>7K%</span></div>', 3))
    + card('<span>Engagements</span>', wrap('<span>3.2K</span><div><svg><path/></svg><span>31K%</span></div>', 4)));
  assert.equal(result.verifiedFollowers?.value, 2200);
  assert.equal(result.analyticsSummary?.impressions?.value, 93400);
  assert.equal(result.analyticsSummary?.engagements?.value, 3200);
  assert.equal(result.analyticsSummary.period.days, 7);
  assert.equal(result.analytics.length, 0, 'seven-day totals never enter the daily records');
});

test('labels nested more than three wrappers still find only their own adjacent value', () => {
  const result = read(`<section>${wrap('<span>Engagements</span>', 5)}${wrap('<span>3,240</span>', 4)}</section>`
    + card('Profile visits', '1.1K'));
  assert.equal(result.analyticsSummary?.engagements?.value, 3240);
  assert.equal(result.analyticsSummary.engagements.approximate, false);
  assert.equal(result.analyticsSummary.profileVisits.value, 1100);
});

test('open metric menus and chart dropdown labels cannot contradict actual metric cards', () => {
  const menu = '<div role="menu"><div role="menuitem"><span>Engagements</span><span>999</span></div></div>';
  const chart = '<section><button aria-haspopup="listbox"><span>Impressions</span><svg/></button><div><span>60K</span></div></section>';
  const result = read(menu + chart + card('Impressions', '93.4K') + card('Engagements', '3.2K'));
  assert.equal(result.analyticsSummary?.impressions?.value, 93400);
  assert.equal(result.analyticsSummary?.engagements?.value, 3200);
  assert.equal(read(menu + chart).analyticsSummary, undefined);
});

test('clickable metric cards remain readable while tooltip and post labels stay excluded', () => {
  for (const [open, close] of [['<button>', '</button>'], ['<div role="button">', '</div>'], ['<div role="button" aria-haspopup="false">', '</div>']]) {
    const result = read(`${open}<div><span>Engagements</span><svg/></div><div><span>3.2K</span><span>31%</span></div>${close}`
      + '<div role="tooltip"><span>Engagements</span><strong>999</strong></div>'
      + '<div role="img" aria-label="Engagements chart"><span>Engagements</span><strong>777</strong></div>'
      + '<article><span>Engagements</span><strong>888</strong></article>');
    assert.equal(result.analyticsSummary?.engagements?.value, 3200);
  }
});

test('growth percentages, denominator-only placeholders and engagement rates are never counts', () => {
  for (const value of ['<span>31K%</span>', '<span>↑31K%</span>', '<span>—</span><span> / 3K</span>', '<span>3.2%</span>']) {
    const result = read(card('Checkmark followers', value) + card('Engagements', value) + card('Impressions', '93.4K'));
    assert.equal(result.verifiedFollowers, undefined);
    assert.equal(result.analyticsSummary?.engagements, undefined);
    assert.equal(result.analyticsSummary?.impressions?.value, 93400);
  }
  const rate = read(card('Engagement rate', '<span>3.2</span><span>%</span>') + card('Impressions', '93.4K'));
  assert.equal(rate.analyticsSummary?.engagements, undefined);
});

test('a missing metric cannot borrow a later unrelated numeric sibling or chart axis', () => {
  for (const markup of [
    '<section><span>Engagements</span><div>—</div><div>999</div></section>',
    '<section><span>Engagements</span><div><span>Engagement rate</span></div><strong>3</strong></section>',
    '<section><span>Engagements</span><div role="img" aria-label="Engagements chart"><span>60K</span></div></section>',
    '<section><span>Engagements</span><div><svg><text>60K</text></svg></div></section>'
  ]) {
    const result = read(markup + card('Impressions', '93.4K'));
    assert.equal(result.analyticsSummary?.engagements, undefined);
    assert.equal(result.analyticsSummary?.impressions?.value, 93400);
  }
});

test('localized verified-follower and engagement labels retain compact-number semantics', () => {
  for (const verifiedLabel of ['已认证的关注者', '已认证关注者', '认证粉丝', '藍 V 粉絲']) {
    const result = read(card(verifiedLabel, '<span>2.2千</span><span>／</span><span>3千</span>')
      + card('互动次数', wrap('<span>3.2万</span><span>↑</span><span>31%</span>', 3)));
    assert.equal(result.verifiedFollowers?.value, 2200, verifiedLabel);
    assert.equal(result.verifiedFollowers.approximate, true);
    assert.equal(result.analyticsSummary?.engagements?.value, 32000);
  }
});

test('hidden stale values are excluded while genuine conflicting cards remain unknown', () => {
  const result = read(card('Engagements', '<span hidden>999</span><span>3.2K</span><span aria-hidden="true">888</span>'));
  assert.equal(result.analyticsSummary?.engagements?.value, 3200);
  assert.equal(read(card('Engagements', '3.2K') + card('Engagements', '4.5K')).analyticsSummary, undefined);
});

test('nested popovers are excluded from values and cannot bridge a missing card to unrelated numbers', () => {
  for (const role of ['tooltip', 'menu', 'listbox']) {
    const popover = `<div><div role="${role}"><div><span>999</span></div></div></div>`;
    const valid = read(card('Engagements', `<div><span>3.2K</span>${popover}</div>`));
    assert.equal(valid.analyticsSummary?.engagements?.value, 3200, `nested ${role} does not contaminate the card`);
    const namedPopover = `<div role="${role}"><span>Engagements</span><span>999</span></div>`;
    assert.equal(read(card('Engagements', `<span>3.2K</span>${namedPopover}`)).analyticsSummary?.engagements?.value, 3200, `labels inside ${role} do not block the actual value`);
    assert.equal(read(card('Engagements', popover)).analyticsSummary, undefined, `${role} alone is not a metric`);
    const missing = read(`<section><span>Engagements</span>${popover}<div>777</div></section>`);
    assert.equal(missing.analyticsSummary, undefined, `excluded ${role} does not let the lookup skip to 777`);
  }
});

test('today fallback shares safe metric-card extraction rather than reading dropdown chart numbers', () => {
  const chart = '<section><button><span>Impressions</span></button><div><strong>60K</strong></div></section>';
  const result = read(chart + card('Impressions', wrap('<span>250</span><div><svg/><span>31%</span></div>', 4)), 'Today');
  assert.equal(result.analyticsSummary?.impressions?.value, 250);
  assert.equal(result.analytics[0]?.value, 250);
  assert.equal(read(chart, 'Today').analytics.length, 0);
});
