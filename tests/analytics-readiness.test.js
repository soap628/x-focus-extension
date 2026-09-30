import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

const context = vm.createContext({ URL });
vm.runInContext(fs.readFileSync(new URL('../scanner.js', import.meta.url), 'utf8'), context);
const { scan, analyticsPending } = context.XFocusScanner;
const start = Date.parse('2026-10-01T04:00:00Z');
const fixture = (period = '<button aria-selected="true">7D</button>', extra = '') => parseHTML(`<html><body><nav><a data-testid="AppTabBar_Profile_Link" href="/soap628">Profile</a></nav><main>${period}${extra}<section><span>Impressions</span><strong>93.4K</strong></section></main></body></html>`).document;
const read = (doc, elapsed = 0) => scan(doc, 'soap628', '/i/account_analytics', new Date(start + elapsed));
function twoMetrics() {
  const doc = fixture('<button aria-selected="true">2W</button>', '<section id="engagements"><span>Engagements</span><strong>3.2K</strong></section>');
  doc.querySelector('main').lastElementChild.id = 'impressions';
  doc.querySelector('#impressions strong').textContent = '98K';
  return doc;
}

test('a permanent determinate follower-goal progressbar does not block account metrics', () => {
  const doc = fixture(undefined, '<div role="progressbar" aria-label="Verified followers target" aria-valuenow="50" aria-valuemax="100"></div>');
  assert.equal(read(doc).analyticsSummary.impressions.value, 93400);
  assert.equal(analyticsPending(doc), false);
  assert.equal(read(doc, 60000).analyticsSummary.period.days, 7);
});

test('explicit busy and spinner markers still block determinate bars until loading settles', () => {
  for (const marker of ['aria-busy="true"', 'data-testid="spinner"']) {
    const doc = fixture(undefined, `<div role="progressbar" aria-valuenow="50" ${marker}></div>`);
    assert.equal(read(doc).analyticsSummary, undefined);
    assert.equal(analyticsPending(doc), true);
    doc.querySelector('[role="progressbar"]').remove();
    assert.equal(read(doc, 2000).analyticsSummary, undefined);
    assert.equal(read(doc, 3600).analyticsSummary.impressions.value, 93400);
  }
  const parentBusy = fixture(undefined, '<section aria-busy="true"><div role="progressbar" aria-valuenow="50"></div></section>');
  assert.equal(read(parentBusy).analyticsSummary, undefined);
});

test('visible indeterminate loading blocks totals, while hidden indicators do not', () => {
  for (const value of ['', 'aria-valuenow=""', 'aria-valuenow="invalid"']) {
    const doc = fixture(undefined, `<div role="progressbar" ${value}></div>`);
    assert.equal(read(doc).analyticsSummary, undefined);
    assert.equal(read(doc, 60000).analyticsSummary, undefined);
  }
  assert.equal(read(fixture(undefined, '<div role="progressbar" hidden></div>')).analyticsSummary.impressions.value, 93400);
});

test('a delayed first period selection accepts stable totals without requiring them to change', () => {
  const doc = fixture('<button>7D</button>');
  assert.equal(read(doc).analyticsSummary, undefined, 'unselected periods do not label totals');
  doc.querySelector('button').setAttribute('aria-selected', 'true');
  assert.equal(read(doc, 2000).analyticsSummary, undefined, 'the newly selected period still waits for stability');
  const settled = read(doc, 3600);
  assert.equal(settled.analyticsSummary.period.days, 7);
  assert.equal(settled.analyticsSummary.impressions.value, 93400);
  assert.equal(analyticsPending(doc), false);
});

test('returning to the accepted period recovers after stability without mislabeling its old totals', () => {
  const doc = fixture('<button aria-selected="true">2W</button>');
  assert.equal(read(doc).analyticsSummary.period.days, 14);
  doc.querySelector('button').textContent = '7D';
  assert.equal(read(doc, 2000).analyticsSummary, undefined);
  assert.equal(read(doc, 62000).analyticsSummary, undefined, 'unchanged 2W cards cannot become 7D totals');
  doc.querySelector('button').textContent = '2W';
  assert.equal(read(doc, 64000).analyticsSummary, undefined);
  const settled = read(doc, 65600);
  assert.equal(settled.analyticsSummary.period.days, 14);
  assert.equal(settled.analyticsSummary.impressions.value, 93400);
  assert.equal(analyticsPending(doc), false);
});

test('losing the selected pill does not forget the last accepted range and its stale-value guard', () => {
  const doc = fixture('<button aria-selected="true">2W</button>');
  read(doc);
  doc.querySelector('button').removeAttribute('aria-selected');
  assert.equal(read(doc, 2000).analyticsSummary, undefined);
  assert.equal(read(doc, 4000).analyticsSummary, undefined);
  doc.querySelector('button').textContent = '7D';
  doc.querySelector('button').setAttribute('aria-selected', 'true');
  assert.equal(read(doc, 6000).analyticsSummary, undefined);
  assert.equal(read(doc, 66000).analyticsSummary, undefined);
  doc.querySelector('strong').textContent = '49K';
  assert.equal(read(doc, 68000).analyticsSummary, undefined);
  const settled = read(doc, 69600);
  assert.equal(settled.analyticsSummary.period.days, 7);
  assert.equal(settled.analyticsSummary.impressions.value, 49000);
});

test('an updated range metric cannot relabel another unchanged metric, even across repeated scans', () => {
  const doc = twoMetrics();
  assert.equal(read(doc).analyticsSummary.engagements.value, 3200);
  doc.querySelector('button').textContent = '7D';
  doc.querySelector('#impressions strong').textContent = '93.4K';
  assert.equal(read(doc, 2000).analyticsSummary, undefined);
  for (const elapsed of [3600, 3600, 8000, 60000]) {
    const partial = read(doc, elapsed).analyticsSummary;
    assert.equal(partial.impressions.value, 93400);
    assert.equal(partial.engagements, undefined, 'old 2W engagements remain unknown in 7D');
    assert.equal(analyticsPending(doc), true);
  }
  doc.querySelector('#engagements strong').textContent = '2.8K';
  assert.equal(read(doc, 62000).analyticsSummary, undefined);
  const completed = read(doc, 63600).analyticsSummary;
  assert.equal(completed.impressions.value, 93400);
  assert.equal(completed.engagements.value, 2800);
  assert.equal(analyticsPending(doc), false);
});

test('a completed explicit loading cycle can confirm an unchanged metric after a partial range update', () => {
  const doc = twoMetrics(); read(doc);
  doc.querySelector('button').textContent = '7D';
  doc.querySelector('#impressions strong').textContent = '93.4K';
  read(doc, 2000);
  assert.equal(read(doc, 3600).analyticsSummary.engagements, undefined);
  doc.querySelector('main').setAttribute('aria-busy', 'true');
  assert.equal(read(doc, 5000).analyticsSummary, undefined);
  doc.querySelector('main').removeAttribute('aria-busy');
  assert.equal(read(doc, 7000).analyticsSummary, undefined);
  assert.equal(read(doc, 8600).analyticsSummary.engagements.value, 3200);
  assert.equal(analyticsPending(doc), false);
});

test('returning to a previously accepted range restores its matching metrics after a partial intervening range', () => {
  const doc = twoMetrics(); read(doc);
  doc.querySelector('button').textContent = '7D';
  doc.querySelector('#impressions strong').textContent = '93.4K';
  read(doc, 2000); read(doc, 3600);
  doc.querySelector('button').textContent = '2W';
  doc.querySelector('#impressions strong').textContent = '98K';
  assert.equal(read(doc, 5000).analyticsSummary, undefined);
  const restored = read(doc, 6600).analyticsSummary;
  assert.equal(restored.period.days, 14);
  assert.equal(restored.impressions.value, 98000);
  assert.equal(restored.engagements.value, 3200);
});

test('null placeholders preserve the old per-metric baseline until a genuinely changed reading arrives', () => {
  const doc = twoMetrics(); read(doc);
  doc.querySelector('button').textContent = '7D';
  doc.querySelector('#impressions strong').textContent = '93.4K';
  doc.querySelector('#engagements strong').textContent = '—';
  read(doc, 2000);
  const partial = read(doc, 3600).analyticsSummary;
  assert.equal(partial.impressions.value, 93400);
  assert.equal(partial.engagements, undefined);
  doc.querySelector('#engagements strong').textContent = '3.2K';
  read(doc, 5000);
  assert.equal(read(doc, 6600).analyticsSummary.engagements, undefined, 'null then the same old value is not a range confirmation');
  doc.querySelector('#engagements strong').textContent = '2.8K';
  read(doc, 8000);
  assert.equal(read(doc, 9600).analyticsSummary.engagements.value, 2800);
});

test('an unchanged old impression cannot become today exposure when only another metric changed', () => {
  const doc = twoMetrics(); read(doc);
  doc.querySelector('button').textContent = 'Today';
  doc.querySelector('#engagements strong').textContent = '200';
  read(doc, 2000);
  const partial = read(doc, 3600);
  assert.equal(partial.analytics.length, 0);
  assert.equal(partial.analyticsSummary.impressions, undefined);
  assert.equal(partial.analyticsSummary.engagements.value, 200);
  doc.querySelector('#impressions strong').textContent = '1,234';
  read(doc, 5000);
  const completed = read(doc, 6600);
  assert.equal(completed.analytics[0].value, 1234);
  assert.equal(completed.analyticsSummary.impressions.value, 1234);
});

test('English and Chinese loading labels keep determinate progressbars in the loading guard', () => {
  for (const label of ['Loading analytics', '正在加载分析数据', '正在載入數據']) {
    const doc = fixture(undefined, `<div role="progressbar" aria-label="${label}" aria-valuenow="50" aria-valuemax="100"></div>`);
    assert.equal(read(doc).analyticsSummary, undefined, label);
    assert.equal(read(doc, 60000).analyticsSummary, undefined, label);
    doc.querySelector('[role="progressbar"]').remove();
    assert.equal(read(doc, 62000).analyticsSummary, undefined);
    assert.equal(read(doc, 63600).analyticsSummary.impressions.value, 93400);
  }
});
