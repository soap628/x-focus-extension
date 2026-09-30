import { dayKey, recentDates, validDay } from './core.js';

export const ACTION_RATES = { posts: 5, replies: 1 };
export const EXP_PER_LEVEL = 100;
const validValue = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const validMetric = metric => metric && validValue(metric.value);
const safeCount = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;

function recentTimestamp(value, date, now, timeZone) {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp > now.getTime()) return false;
  const collectedDate = dayKey(new Date(timestamp), timeZone);
  return collectedDate >= recentDates(date, 28)[0] && collectedDate <= date;
}

export function actionExperience(state) {
  const actions = actionCounts(state);
  return actions.postXp + actions.replyXp;
}

export function actionCounts(state) {
  const counts = Object.values(state.days || {}).reduce((total, day) => ({
    posts: total.posts + safeCount(day.posts), replies: total.replies + safeCount(day.replies)
  }), { posts: 0, replies: 0 });
  return { ...counts, postXp: counts.posts * ACTION_RATES.posts, replyXp: counts.replies * ACTION_RATES.replies };
}

export function latestMetric(state, key, date) {
  const latestDate = Object.keys(state.days || {}).filter(d => validDay(d) && d <= date && validMetric(state.days[d][key])).sort().at(-1);
  if (!latestDate) return null;
  const metric = state.days[latestDate][key];
  return { value: metric.value, approximate: !!metric.approximate, date: latestDate, source: metric.source || null, at: metric.at || null };
}

function recentSummary(state, date, now) {
  const summary = state.analyticsSummary, period = summary?.period;
  if (!period || !Number.isInteger(period.days) || period.days < 1 || period.days > 366) return null;
  if ((period.start != null) !== (period.end != null)) return null;
  if (period.start != null && (!validDay(period.start) || !validDay(period.end) || (Date.parse(period.end) - Date.parse(period.start)) / 86400000 + 1 !== period.days)) return null;
  if (!recentTimestamp(summary.at, date, now, state.settings?.timeZone)) return null;
  const oldest = recentDates(date, 28)[0];
  // A recently opened historic report is still historic, even if collected now.
  if (period.end != null && (!validDay(period.end) || period.end < oldest || period.end > date)) return null;
  if (period.start != null && (!validDay(period.start) || period.start > date || (period.end && period.start > period.end))) return null;
  return summary;
}

function averageMetric(summary, key, date, now, timeZone) {
  if (!summary || !validMetric(summary[key])) return null;
  const metric = summary[key], period = summary.period;
  // A refreshed envelope may retain an older metric. Judge the metric's own
  // timestamp, and never let a newer envelope make that reading appear fresh.
  // Missing timestamps are allowed for older in-memory data only; the backup
  // validator requires an explicit timestamp for current analytics metrics.
  const at = metric.at ?? summary.at;
  if (!recentTimestamp(at, date, now, timeZone) || Date.parse(at) > Date.parse(summary.at)) return null;
  const label = typeof period.label === 'string' && period.label.trim() ? period.label.trim().slice(0, 80) : `${period.days} 天`;
  return {
    value: metric.value / period.days, approximate: !!metric.approximate,
    sourceLabel: `${label} · ${period.days} 天日均`, at,
    period: { label, days: period.days, start: period.start || null, end: period.end || null },
    totalValue: metric.value
  };
}

function sampledImpressions(state, date, now) {
  const dates = recentDates(date, 28).filter(d => {
    const metric = state.days?.[d]?.impressions;
    if (!validMetric(metric)) return false;
    // Legacy daily readings without collection timestamps retain their dated
    // meaning. An explicit stale, invalid, or future timestamp is not ignored.
    if (metric.at == null) return true;
    return recentTimestamp(metric.at, date, now, state.settings?.timeZone)
      && dayKey(new Date(metric.at), state.settings?.timeZone) >= d;
  });
  if (!dates.length) return null;
  const readings = dates.map(d => state.days[d].impressions);
  const timestamps = readings.map(m => m.at).filter(at => Number.isFinite(Date.parse(at))).sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    value: readings.reduce((sum, metric) => sum + metric.value, 0) / readings.length,
    approximate: readings.some(metric => !!metric.approximate),
    sourceLabel: `已采集 ${dates.length} 天日均`, at: timestamps.at(-1) || null,
    period: { label: '近 28 天内已采集日', days: dates.length, start: dates[0], end: dates.at(-1) },
    totalValue: readings.reduce((sum, metric) => sum + metric.value, 0)
  };
}

// Performance snapshots are display-only and never contribute experience.
export function accountAnalytics(state, now = new Date()) {
  const date = dayKey(now, state.settings?.timeZone);
  const summary = recentSummary(state, date, now);
  return {
    impressions: averageMetric(summary, 'impressions', date, now, state.settings?.timeZone) || sampledImpressions(state, date, now),
    engagements: averageMetric(summary, 'engagements', date, now, state.settings?.timeZone)
  };
}

export function assessAccount(state) {
  const actions = actionCounts(state);
  const totalXp = actions.postXp + actions.replyXp;
  const progress = totalXp % EXP_PER_LEVEL;
  return {
    version: 'action-v1', score: totalXp, totalXp, maxScore: null, expPerLevel: EXP_PER_LEVEL,
    level: 1 + Math.floor(totalXp / EXP_PER_LEVEL), progress, toNext: EXP_PER_LEVEL - progress,
    atMax: false, coverage: 2, total: 2, provisional: false, actions,
    dimensions: [
      { key: 'posts', count: actions.posts, rate: ACTION_RATES.posts, xp: actions.postXp },
      { key: 'replies', count: actions.replies, rate: ACTION_RATES.replies, xp: actions.replyXp }
    ]
  };
}
