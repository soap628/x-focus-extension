import { dayKey, followerDelta, progress } from './core.js';
import { actionExperience, assessAccount, latestMetric } from './assessment.js';
import { rewardsSummary } from './rewards.js';

// Only the values displayed by the page HUD cross into the content script.
export function hudSummary(state, now = new Date()) {
  const date = dayKey(now, state.settings.timeZone);
  const today = state.days[date] || { posts: 0, replies: 0, goals: state.settings, auto: {} };
  const xp = actionExperience(state);
  const assessment = assessAccount(state, now);
  const followerDate = Object.keys(state.days).filter(d => d <= date && state.days[d].followers).sort().at(-1);
  const followers = followerDate ? state.days[followerDate].followers : null;
  const delta = followerDate ? followerDelta(state, followerDate) : null;
  const impressions = today.impressions;
  return {
    date, username: state.settings.username, enabled: state.tracking.enabled, language: state.settings.language || 'zh-CN', rewards: rewardsSummary(state),
    tracking: { startedAt: state.tracking.startedAt, lastNetworkAt: state.tracking.lastNetworkAt, lastPageAt: state.tracking.lastPageAt, lastPublishAt: state.tracking.lastPublishAt },
    posts: today.posts, replies: today.replies,
    goals: { posts: today.goals.posts, replies: today.goals.replies },
    auto: { posts: today.auto?.posts || 0, replies: today.auto?.replies || 0 },
    level: assessment.level, xp: xp % 100, totalXp: xp, assessment,
    complete: progress(today).complete,
    followers: followers ? { value: followers.value, approximate: followers.approximate, date: followerDate } : null,
    verifiedFollowers: latestMetric(state, 'verifiedFollowers', date),
    blueVerified: typeof state.account?.blueVerified?.value === 'boolean' ? { value: state.account.blueVerified.value, source: state.account.blueVerified.source || null, at: state.account.blueVerified.at || null } : null,
    delta: delta ? { value: delta.value, approximate: delta.approximate, from: delta.previousDate } : null,
    views: impressions ? { value: impressions.value, approximate: impressions.approximate, kind: 'impressions' }
      : today.trackedViews != null ? { value: today.trackedViews, approximate: false, kind: 'tracked' } : null
  };
}

export function hudAction(message, state) {
  if (message.command === 'language') {
    if (!['zh-CN', 'en'].includes(message.language)) throw new Error('不支持的界面语言');
    return { type: 'language', language: message.language };
  }
  if (message.command === 'open-chest') {
    if (message.id !== undefined && (typeof message.id !== 'string' || !/^(?:daily:\d{4}-\d{2}-\d{2}|level:\d{1,2})$/.test(message.id))) throw new Error('无效的宝箱编号');
    return { type: 'open-chest', ...(message.id !== undefined ? { id: message.id } : {}) };
  }
  if (message.command === 'goals') return { type: 'settings', username: state.settings.username, posts: message.posts, replies: message.replies };
  if (message.command === 'adjust') return { type: 'adjust', kind: message.kind, amount: message.amount };
  if (message.command === 'tracking') return { type: 'tracking', enabled: message.enabled };
  throw new Error('未知的任务卡操作');
}
