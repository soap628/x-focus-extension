import { dayKey, recentDates, validDay } from './core.js';

// The score is deliberately a snapshot, not a balance that gains points each
// time analytics is opened. Every dimension has the same 200-point ceiling.
const DIMENSIONS = [
  { key: 'action', label: '行动', unit: 'XP', benchmark: 20000 },
  { key: 'followers', label: '总粉丝', unit: '人', benchmark: 100000 },
  { key: 'verifiedFollowers', label: '认证粉丝', unit: '人', benchmark: 25000 },
  { key: 'impressions', label: '曝光', unit: '次 / 日', benchmark: 100000 },
  { key: 'engagements', label: '互动', unit: '次 / 日', benchmark: 10000 }
];
const validValue = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const validMetric = metric => metric && validValue(metric.value);
const safeCount = value => validValue(value) ? value : 0;

function recentTimestamp(value, date, now, timeZone) {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp > now.getTime()) return false;
  const collectedDate = dayKey(new Date(timestamp), timeZone);
  return collectedDate >= recentDates(date, 28)[0] && collectedDate <= date;
}

export function actionExperience(state) {
  return Object.values(state.days || {}).reduce((sum, day) => sum + safeCount(day.posts) * 20 + safeCount(day.replies) * 5, 0);
}

export function latestMetric(state, key, date) {
  const latestDate = Object.keys(state.days || {}).filter(d => validDay(d) && d <= date && validMetric(state.days[d][key])).sort().at(-1);
  if (!latestDate) return null;
  const metric = state.days[latestDate][key];
  return { value: metric.value, approximate: !!metric.approximate, date: latestDate, source: metric.source || null, at: metric.at || null };
}

function recentSummary(state, date, now) {
  const summary = state.analyticsSummary, period = summary?.period;
  if (!period || !Number.isInteger(period.days) || period.days < 7 || period.days > 366) return null;
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

function followerReading(metric) {
  return metric ? { ...metric, sourceLabel: `${metric.date} 快照` } : null;
}

export function assessAccount(state, now = new Date()) {
  const date = dayKey(now, state.settings?.timeZone);
  const summary = recentSummary(state, date, now);
  const readings = {
    action: { value: actionExperience(state), approximate: false, sourceLabel: '本机累计 · 发帖 20 XP / 回复 5 XP', at: state.tracking?.lastPublishAt || null },
    followers: followerReading(latestMetric(state, 'followers', date)),
    verifiedFollowers: followerReading(latestMetric(state, 'verifiedFollowers', date)),
    impressions: averageMetric(summary, 'impressions', date, now, state.settings?.timeZone) || sampledImpressions(state, date, now),
    engagements: averageMetric(summary, 'engagements', date, now, state.settings?.timeZone)
  };
  const dimensions = DIMENSIONS.map(definition => {
    const reading = readings[definition.key];
    return {
      ...definition, max: 200,
      value: reading?.value ?? null,
      score: reading ? Math.min(200, Math.round(200 * Math.log1p(reading.value) / Math.log1p(definition.benchmark))) : null,
      sourceLabel: reading?.sourceLabel || '未采集',
      approximate: reading?.approximate || false,
      at: reading?.at || null,
      ...(reading?.period ? { period: reading.period, totalValue: reading.totalValue } : {})
    };
  });
  const score = dimensions.reduce((sum, dimension) => sum + (dimension.score ?? 0), 0);
  const coverage = dimensions.filter(dimension => dimension.score !== null).length;
  const atMax = score >= 980;
  return {
    version: 'balanced-v1', score, maxScore: 1000,
    level: Math.min(50, 1 + Math.floor(score / 20)),
    progress: atMax ? 100 : (score % 20) / 20 * 100,
    toNext: atMax ? 0 : 20 - score % 20,
    atMax, coverage, total: DIMENSIONS.length, provisional: coverage < DIMENSIONS.length,
    dimensions
  };
}
