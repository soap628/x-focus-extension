import { newState, reduce, dayKey, recentDates } from './core.js';
import { hudSummary, hudAction } from './hud-state.js';
import { initializeRewards, settleRewards, openChest } from './rewards.js';
function demoState() {
  const now = new Date(), today = dayKey(now), yesterday = recentDates(today, 2)[0];
  let state = reduce(newState(), { type: 'settings', username: 'soap628', posts: 2, replies: 10 }, now);
  state = reduce(state, { type: 'daily', date: yesterday, posts: 12, replies: 20, followers: 2980, impressions: null, note: '虚构示例数据' }, now);
  state = reduce(state, { type: 'daily', date: today, posts: 1, replies: 6, followers: 3043, impressions: 1830, note: '虚构示例数据' }, now);
  state = reduce(state, { type: 'capture', username: 'soap628', posts: [], verifiedFollowers: { value: 2200, approximate: true }, blueVerified: true, analyticsSummary: { period: { label: '2W', days: 14, start: null, end: null }, impressions: { value: 98000, approximate: true }, engagements: { value: 3200, approximate: true } } }, now);
  state.days[today].auto = { posts: 1, replies: 6 };
  state = initializeRewards(state, now);
  try {
    const preferences = JSON.parse(localStorage.getItem('xFocusPreviewHudPreferences') || 'null');
    if (preferences) state = reduce(state, { type: 'hud-preferences', preferences }, now);
  } catch { /* An old or invalid preview preference falls back to the default. */ }
  // Start with no chests; simulated new actions unlock the real daily reward.
  return state;
}
let state = demoState();
function apply(action) { const now = new Date(); state = settleRewards(state, reduce(state, action, now), action, now); }
const hud = XFocusHUD.mount({ onCommand: async action => {
  if (action.command === 'open-chest') state = openChest(state);
  else if (action.command !== 'scan-now') {
    apply(hudAction(action, state));
    if (action.command === 'hud-preferences') localStorage.setItem('xFocusPreviewHudPreferences', JSON.stringify(state.hudPreferences));
  }
  return hudSummary(state);
} });
hud.setConnection({ status: 'demo', code: 'demo', message: '这里是界面演示，使用示例数据，未连接真实 X。安装后会显示当前页面的实际连接状态。' });
const render = () => hud.update(hudSummary(state));
let demoSequence = 0;
function simulate(kind) { const now = new Date(); apply({ type: 'network', username: state.settings.username, posts: [{ id: `${now.getTime()}${++demoSequence}`, kind, text: 'Offline sample action', views: 0, approximate: false, createdAt: now.toISOString() }] }); render(); }
document.querySelector('#demo-post').addEventListener('click', () => simulate('posts'));
document.querySelector('#demo-reply').addEventListener('click', () => simulate('replies'));
document.querySelector('#demo-reset').addEventListener('click', () => { localStorage.removeItem('xFocusPreviewHudPreferences'); state = demoState(); render(); });
render();
