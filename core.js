export const STORAGE_KEY = 'xFocusV1';
export const DEFAULTS = { username: '', posts: 2, replies: 10, timeZone: 'Asia/Shanghai', language: 'zh-CN' };
export const REWARD_ITEM_IDS = ['quill', 'compass', 'key', 'ring', 'gem', 'scroll', 'chalice', 'blade', 'feather', 'lantern', 'crown', 'seal'];
export const MAX_REWARDS = 5010;
export function newState() { return { version: 2, settings: { ...DEFAULTS }, days: {}, posts: {}, account: { blueVerified: null }, analyticsSummary: null, rewards: null, lastCapture: null, tracking: { enabled: true, startedAt: null, lastNetworkAt: null, lastPublishAt: null, lastPageAt: null } }; }
export function upgradeState(input, now = new Date()) {
  const state = structuredClone(input);
  state.version = 2;
  state.settings = { ...DEFAULTS, ...state.settings };
  state.tracking = { ...newState().tracking, ...state.tracking };
  state.tracking.startedAt ||= now.toISOString();
  state.account = { blueVerified: null, ...state.account };
  state.analyticsSummary ??= null;
  state.rewards ??= null;
  for (const day of Object.values(state.days)) {
    day.verifiedFollowers ??= null;
    day.auto ??= { posts: 0, replies: 0 };
    day.trackedViews ??= null;
    day.trackedIds ??= [];
    day.loggedPostIds ??= [];
  }
  return state;
}
export function dayKey(now = new Date(), timeZone = DEFAULTS.timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = type => parts.find(p => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function validDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function integer(value, max = 1e12) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max; }
export function ensureDay(state, date) {
  if (!validDay(date)) throw new Error('日期格式不正确');
  state.days[date] ??= { posts: 0, replies: 0, goals: { posts: state.settings.posts, replies: state.settings.replies }, followers: null, verifiedFollowers: null, impressions: null, note: '', loggedPostIds: [], auto: { posts: 0, replies: 0 }, trackedViews: null, trackedIds: [] };
  return state.days[date];
}
export function recentDates(end, count) {
  const date = new Date(`${end}T12:00:00Z`);
  return Array.from({ length: count }, (_, index) => { const d = new Date(date); d.setUTCDate(d.getUTCDate() - count + 1 + index); return d.toISOString().slice(0, 10); });
}
export function progress(day) {
  const goals = ['posts', 'replies'].filter(key => day.goals[key] > 0);
  if (!goals.length) return { percent: 0, complete: false, enabled: false };
  const percent = Math.round(goals.reduce((sum, key) => sum + Math.min(day[key] / day.goals[key], 1), 0) / goals.length * 100);
  return { percent, complete: goals.every(key => day[key] >= day.goals[key]), enabled: true };
}
export function streak(state, today) {
  const dates = recentDates(today, 3660).reverse();
  if (!state.days[today] || !progress(state.days[today]).complete) dates.shift();
  let result = 0;
  for (const date of dates) { if (!state.days[date] || !progress(state.days[date]).complete) break; result++; }
  return result;
}
export function followerDelta(state, date) {
  const current = state.days[date]?.followers;
  if (!current) return null;
  const previousDate = Object.keys(state.days).filter(d => d < date && state.days[d].followers).sort().at(-1);
  if (!previousDate) return null;
  const previous = state.days[previousDate].followers;
  return { value: current.value - previous.value, previousDate, approximate: current.approximate || previous.approximate };
}
function metric(value, source, now, approximate = false) { return { value, source, at: now.toISOString(), approximate }; }
const summaryKeys = ['impressions', 'engagements', 'profileVisits'];
function analyticsPeriod(period) {
  if (!period || Array.isArray(period) || typeof period.label !== 'string' || !period.label.trim() || period.label.length > 80 || /[\u0000-\u001f\u007f]/.test(period.label) || !integer(period.days, 366) || period.days < 1) throw new Error('分析周期无效');
  const start = period.start ?? null, end = period.end ?? null;
  if ((start === null) !== (end === null) || (start !== null && (!validDay(start) || !validDay(end) || start > end || (Date.parse(end) - Date.parse(start)) / 86400000 + 1 !== period.days))) throw new Error('分析周期日期不一致');
  return { label: period.label.trim(), days: period.days, start, end };
}
function incomingMetric(value, source, now) {
  if (!value || Array.isArray(value) || !integer(value.value) || (value.approximate !== undefined && typeof value.approximate !== 'boolean')) throw new Error('采集指标须为非负整数');
  return metric(value.value, source, now, value.approximate ?? false);
}
function mayReplaceMetric(previous, current) {
  return previous?.source !== 'manual' && !(previous && !previous.approximate && current.approximate);
}
function sameAnalyticsPeriod(previous, period, now) {
  if (!previous || previous.period.days !== period.days || previous.period.start !== period.start || previous.period.end !== period.end) return false;
  // A rolling range without dates is a different snapshot on the next day.
  return period.start !== null || (previous.period.label === period.label && dayKey(new Date(previous.at)) === dayKey(now));
}
export function reduce(state, action, now = new Date()) {
  const next = upgradeState(state, now);
  const today = dayKey(now, state.settings.timeZone);
  if (action.type === 'language') {
    if (!['zh-CN', 'en'].includes(action.language)) throw new Error('不支持的界面语言');
    next.settings.language = action.language;
  } else if (action.type === 'tracking') {
    if (typeof action.enabled !== 'boolean') throw new Error('无效的自动统计设置');
    if (!next.tracking.enabled && action.enabled) next.tracking.startedAt = now.toISOString();
    next.tracking.enabled = action.enabled;
  } else if (action.type === 'bind') {
    if (!/^[a-z0-9_]{1,15}$/.test(action.username || '')) throw new Error('无法识别登录账号');
    if (!next.settings.username) next.settings.username = action.username;
  } else if (action.type === 'heartbeat') {
    if (action.username === next.settings.username) next.tracking.lastPageAt = now.toISOString();
  } else if (action.type === 'settings') {
    const username = String(action.username || '').trim().replace(/^@/, '').toLowerCase();
    if (username && !/^[a-z0-9_]{1,15}$/.test(username)) throw new Error('请输入有效的 X 用户名，不含网址');
    if (state.settings.username && username !== state.settings.username && (Object.keys(state.days).length || Object.keys(state.posts).length || state.account?.blueVerified != null || state.analyticsSummary != null || state.rewards?.earned?.length > 0 || state.rewards?.levelHighWater > 1)) throw new Error('已有数据已绑定当前账号。切换账号请先导出备份，再使用另一浏览器配置文件。');
    if (!integer(action.posts, 1000) || !integer(action.replies, 1000)) throw new Error('每日目标须为 0–1000 的整数');
    next.settings = { ...next.settings, username, posts: action.posts, replies: action.replies };
    ensureDay(next, today).goals = { posts: action.posts, replies: action.replies };
  } else if (action.type === 'adjust') {
    if (!['posts', 'replies'].includes(action.kind) || ![-1, 1].includes(action.amount)) throw new Error('无效的计数操作');
    const day = ensureDay(next, today);
    day[action.kind] = Math.max(0, Math.min(10000, day[action.kind] + action.amount));
  } else if (action.type === 'daily') {
    if (!validDay(action.date) || action.date > today) throw new Error('请选择今天或更早的日期');
    const day = ensureDay(next, action.date);
    for (const key of ['followers', 'verifiedFollowers', 'impressions']) {
      if (action[key] !== null && action[key] !== undefined) {
        if (!integer(action[key])) throw new Error('数据须为非负整数');
        day[key] = metric(action[key], 'manual', now);
      }
    }
    for (const key of ['posts', 'replies']) {
      if (action[key] !== null && action[key] !== undefined) {
        if (!integer(action[key], 10000)) throw new Error('条数须为 0–10000 的整数');
        day[key] = action[key];
      }
    }
    if (typeof action.note !== 'string' || action.note.length > 1000) throw new Error('复盘请控制在 1000 字以内');
    day.note = action.note;
  } else if (action.type === 'capture' || action.type === 'network') {
    if (!next.settings.username || action.username?.toLowerCase() !== next.settings.username) throw new Error('页面账号与绑定账号不一致');
    if (action.type === 'network' && !next.tracking.enabled) return next;
    if (action.type === 'network') next.tracking.lastNetworkAt = now.toISOString();
    let captured = false;
    if (action.followers && integer(action.followers.value)) {
      const day = ensureDay(next, today);
      // Manual readings keep priority; a rounded label never replaces an exact reading.
      if (day.followers?.source !== 'manual' && !(day.followers && !day.followers.approximate && action.followers.approximate)) {
        day.followers = metric(action.followers.value, action.type === 'network' ? 'network' : 'page', now, Boolean(action.followers.approximate));
      }
      captured = true;
    }
    const source = action.type === 'network' ? 'network' : 'page';
    if (action.verifiedFollowers != null) {
      const incoming = incomingMetric(action.verifiedFollowers, source, now);
      const day = ensureDay(next, today);
      if (mayReplaceMetric(day.verifiedFollowers, incoming)) day.verifiedFollowers = incoming;
      captured = true;
    }
    if (action.blueVerified != null) {
      if (typeof action.blueVerified !== 'boolean') throw new Error('蓝 V 状态无效');
      if (next.account.blueVerified?.source !== 'manual') next.account.blueVerified = { value: action.blueVerified, source, at: now.toISOString() };
      captured = true;
    }
    if (action.analyticsSummary != null) {
      const value = action.analyticsSummary;
      const period = analyticsPeriod(value.period);
      if (period.end !== null && period.end > today) throw new Error('分析周期不能晚于今天');
      const samePeriod = sameAnalyticsPeriod(next.analyticsSummary, period, now);
      const summary = samePeriod ? { ...next.analyticsSummary, period } : { period, impressions: null, engagements: null, profileVisits: null };
      let received = false;
      for (const key of summaryKeys) if (value[key] != null) {
        const incoming = incomingMetric(value[key], source, now);
        if (mayReplaceMetric(summary[key], incoming)) summary[key] = incoming;
        received = true;
      }
      if (!received) throw new Error('分析快照缺少有效指标');
      // Keep one range snapshot. Never add overlapping 7D/2W/4W totals.
      next.analyticsSummary = { ...summary, at: now.toISOString(), source };
      captured = true;
    }
    if (Array.isArray(action.analytics)) for (const entry of action.analytics.slice(0, 31)) {
      if (!validDay(entry.date) || entry.date > today || !integer(entry.value)) continue;
      const day = ensureDay(next, entry.date);
      if (day.impressions?.source !== 'manual' && !(day.impressions && !day.impressions.approximate && entry.approximate)) day.impressions = metric(entry.value, 'analytics', now, !!entry.approximate);
      captured = true;
    }
    if (Array.isArray(action.posts)) for (const post of action.posts.slice(0, 200)) {
      if (!/^\d{1,30}$/.test(post.id) || !(integer(post.views) || post.views === null) || typeof post.text !== 'string' || !Number.isFinite(Date.parse(post.createdAt)) || Date.parse(post.createdAt) > now.getTime() + 60000) continue;
      const date = dayKey(new Date(post.createdAt), next.settings.timeZone);
      if (action.type === 'network' && !post.edited && ['posts', 'replies'].includes(post.kind) && Date.parse(post.createdAt) >= Date.parse(next.tracking.startedAt) && date <= today && !Object.values(next.days).some(d => d.loggedPostIds.includes(post.id))) {
        const day = ensureDay(next, date);
        if (day.loggedPostIds.length < 20000) { day[post.kind] = Math.min(10000, day[post.kind] + 1); day.auto[post.kind]++; day.loggedPostIds.push(post.id); next.tracking.lastPublishAt = now.toISOString(); }
      }
      const existing = next.posts[post.id];
      if (existing && integer(existing.views) && (!post.views && post.views !== 0 || !existing.approximate && post.approximate)) continue;
      const saved = { ...existing, id: post.id, text: post.text.slice(0, 500), views: post.views, approximate: Boolean(post.approximate), createdAt: new Date(post.createdAt).toISOString(), observedAt: now.toISOString() };
      // Only exact values enter the daily increment. For an old post first seen
      // today, establish a baseline; never allocate an overnight gap to today.
      if (integer(post.views) && !post.approximate) {
        const day = ensureDay(next, today);
        const sameDay = existing?.viewDay === today;
        const bornToday = date === today && Date.parse(post.createdAt) >= Date.parse(next.tracking.startedAt);
        const baseline = sameDay ? existing.viewMaximum : bornToday ? 0 : post.views;
        const increment = Math.max(0, post.views - baseline);
        day.trackedViews = (day.trackedViews || 0) + increment;
        if (!day.trackedIds.includes(post.id) && day.trackedIds.length < 20000) day.trackedIds.push(post.id);
        saved.viewDay = today; saved.viewMaximum = Math.max(baseline, post.views);
      }
      next.posts[post.id] = saved;
      captured = true;
    }
    const keys = Object.keys(next.posts).sort((a, b) => next.posts[b].observedAt.localeCompare(next.posts[a].observedAt));
    for (const id of keys.slice(1000)) delete next.posts[id];
    if (captured) next.lastCapture = now.toISOString();
  } else if (action.type === 'import') {
    return upgradeState(validateBackup(action.data), now);
  } else throw new Error('未知操作');
  return next;
}
export function validateBackup(input) {
  if (!input || ![1, 2].includes(input.version) || !input.settings || !input.days || !input.posts || typeof input.days !== 'object' || typeof input.posts !== 'object') throw new Error('不是有效的 X Focus 备份');
  const s = input.settings;
  if (typeof s.username !== 'string' || (s.username && !/^[a-z0-9_]{1,15}$/.test(s.username)) || !integer(s.posts, 1000) || !integer(s.replies, 1000) || s.timeZone !== 'Asia/Shanghai' || (s.language !== undefined && !['zh-CN', 'en'].includes(s.language))) throw new Error('备份设置无效');
  if (Array.isArray(input.days) || Array.isArray(input.posts) || Object.keys(input.days).length > 5000 || Object.keys(input.posts).length > 1000) throw new Error('备份数据量或格式不正确');
  const clean = newState(); clean.settings = { username: s.username, posts: s.posts, replies: s.replies, timeZone: s.timeZone, language: s.language ?? 'zh-CN' };
  const cleanMetric = m => {
    if (m === null) return null;
    if (!m || !integer(m.value) || !['manual', 'page', 'network', 'analytics'].includes(m.source) || typeof m.at !== 'string' || !Number.isFinite(Date.parse(m.at)) || typeof m.approximate !== 'boolean') throw new Error('备份指标无效');
    return { value: m.value, source: m.source, at: new Date(m.at).toISOString(), approximate: m.approximate };
  };
  for (const [date, d] of Object.entries(input.days)) {
    if (!validDay(date) || !d || !integer(d.posts, 10000) || !integer(d.replies, 10000) || !d.goals || !integer(d.goals.posts, 1000) || !integer(d.goals.replies, 1000) || typeof d.note !== 'string' || d.note.length > 1000) throw new Error('备份日记录无效');
    const ids = value => { if (!Array.isArray(value) || value.length > 20000 || value.some(id => typeof id !== 'string' || !/^\d{1,30}$/.test(id))) throw new Error('备份自动统计记录无效'); return [...new Set(value)]; };
    const auto = d.auto || { posts: 0, replies: 0 };
    if (!integer(auto.posts, 20000) || !integer(auto.replies, 20000) || !(d.trackedViews == null || integer(d.trackedViews))) throw new Error('备份自动计数无效');
    clean.days[date] = { posts: d.posts, replies: d.replies, goals: { posts: d.goals.posts, replies: d.goals.replies }, followers: cleanMetric(d.followers), verifiedFollowers: cleanMetric(d.verifiedFollowers ?? null), impressions: cleanMetric(d.impressions), note: d.note, loggedPostIds: ids(d.loggedPostIds || []), auto: { posts: auto.posts, replies: auto.replies }, trackedViews: d.trackedViews ?? null, trackedIds: ids(d.trackedIds || []) };
  }
  for (const [id, p] of Object.entries(input.posts)) {
    if (!/^\d{1,30}$/.test(id) || p.id !== id || !(integer(p.views) || p.views === null) || typeof p.text !== 'string' || p.text.length > 500 || !Number.isFinite(Date.parse(p.createdAt)) || !Number.isFinite(Date.parse(p.observedAt))) throw new Error('备份帖子无效');
    clean.posts[id] = { id, views: p.views, text: p.text, approximate: Boolean(p.approximate), createdAt: new Date(p.createdAt).toISOString(), observedAt: new Date(p.observedAt).toISOString() };
    if (p.viewDay !== undefined) { if (!validDay(p.viewDay) || !integer(p.viewMaximum)) throw new Error('备份浏览量基线无效'); clean.posts[id].viewDay = p.viewDay; clean.posts[id].viewMaximum = p.viewMaximum; }
  }
  clean.lastCapture = input.lastCapture && Number.isFinite(Date.parse(input.lastCapture)) ? new Date(input.lastCapture).toISOString() : null;
  if (input.account != null) {
    if (typeof input.account !== 'object' || Array.isArray(input.account)) throw new Error('备份账号状态无效');
    const verified = input.account.blueVerified;
    if (verified != null) {
      if (typeof verified.value !== 'boolean' || !['manual', 'page', 'network'].includes(verified.source) || typeof verified.at !== 'string' || !Number.isFinite(Date.parse(verified.at))) throw new Error('备份蓝 V 状态无效');
      clean.account.blueVerified = { value: verified.value, source: verified.source, at: new Date(verified.at).toISOString() };
    }
  }
  if (input.analyticsSummary != null) {
    const summary = input.analyticsSummary;
    if (typeof summary !== 'object' || Array.isArray(summary) || typeof summary.at !== 'string' || !Number.isFinite(Date.parse(summary.at)) || !['manual', 'page', 'network', 'analytics'].includes(summary.source)) throw new Error('备份分析快照无效');
    const period = analyticsPeriod(summary.period);
    if (period.end !== null && period.end > dayKey(new Date(summary.at))) throw new Error('备份分析快照日期无效');
    const cleanSummary = { period, at: new Date(summary.at).toISOString(), source: summary.source };
    for (const key of summaryKeys) cleanSummary[key] = cleanMetric(summary[key] ?? null);
    if (summaryKeys.every(key => cleanSummary[key] === null)) throw new Error('备份分析快照缺少指标');
    clean.analyticsSummary = cleanSummary;
  }
  if (input.tracking) {
    if (typeof input.tracking.enabled !== 'boolean') throw new Error('备份自动设置无效');
    clean.tracking.enabled = input.tracking.enabled;
    for (const key of ['startedAt', 'lastNetworkAt', 'lastPublishAt', 'lastPageAt']) { const value = input.tracking[key]; if (value != null && !Number.isFinite(Date.parse(value))) throw new Error('备份自动统计时间无效'); clean.tracking[key] = value ? new Date(value).toISOString() : null; }
  }
  clean.rewards = validateRewards(input.rewards ?? null);
  return clean;
}
export function validateRewards(input) {
  if (input === null) return null;
  const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && validDay(value.slice(0, 10)) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
  if (!input || Array.isArray(input) || input.version !== 1 || !timestamp(input.initializedAt) || !integer(input.levelHighWater, 50) || input.levelHighWater < 1 || !Array.isArray(input.earned) || input.earned.length > MAX_REWARDS) throw new Error('备份收藏记录无效');
  const initializedAt = new Date(input.initializedAt).toISOString();
  const initializedDate = dayKey(new Date(initializedAt));
  const ids = new Set();
  const earned = input.earned.map(event => {
    if (!event || Array.isArray(event) || typeof event.id !== 'string' || ids.has(event.id) || !['daily', 'level'].includes(event.reason) || !validDay(event.date) || event.date < initializedDate) throw new Error('备份宝箱事件无效');
    if (event.reason === 'daily' && (event.id !== `daily:${event.date}` || event.level !== undefined)) throw new Error('备份每日宝箱无效');
    if (event.reason === 'level' && (!integer(event.level, 50) || event.level < 5 || event.level % 5 !== 0 || event.level > input.levelHighWater || event.id !== `level:${event.level}`)) throw new Error('备份等级宝箱无效');
    const pending = event.openedAt === null && event.itemId === null;
    if (!pending && (!timestamp(event.openedAt) || !REWARD_ITEM_IDS.includes(event.itemId) || Date.parse(event.openedAt) < Date.parse(initializedAt) || dayKey(new Date(event.openedAt)) < event.date)) throw new Error('备份开箱结果无效');
    ids.add(event.id);
    return { id: event.id, reason: event.reason, date: event.date, ...(event.reason === 'level' ? { level: event.level } : {}), openedAt: pending ? null : new Date(event.openedAt).toISOString(), itemId: pending ? null : event.itemId };
  });
  return { version: 1, initializedAt, levelHighWater: input.levelHighWater, earned };
}
export function csv(state) {
  const escape = value => `"${String(value ?? '').replace(/^(?:\s*[=+@\-]|[\t\r])/, "'$&").replaceAll('"', '""')}"`;
  const rows = [['日期', '发帖', '发帖目标', '回复', '回复目标', '自动发帖', '自动回复', '粉丝', '粉丝是否近似', '粉丝来源', '认证粉丝', '认证粉丝是否近似', '认证粉丝来源', '账号当日曝光', '曝光来源', '已跟踪帖子新增浏览', '复盘']];
  for (const date of Object.keys(state.days).sort()) { const d = state.days[date]; rows.push([date, d.posts, d.goals.posts, d.replies, d.goals.replies, d.auto?.posts || 0, d.auto?.replies || 0, d.followers?.value, d.followers ? d.followers.approximate : '', d.followers?.source, d.verifiedFollowers?.value, d.verifiedFollowers ? d.verifiedFollowers.approximate : '', d.verifiedFollowers?.source, d.impressions?.value, d.impressions?.source, d.trackedViews, d.note]); }
  return '\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\r\n');
}
