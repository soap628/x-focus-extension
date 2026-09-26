import { dayKey, MAX_REWARDS } from './core.js';
import { assessAccount } from './assessment.js';

// Cosmetic collectibles are fixed local data. They never alter account scores.
const item = (id, rarity, zh, en, zhDescription, enDescription) => ({ id, kind: id, rarity, name: { 'zh-CN': zh, en }, description: { 'zh-CN': zhDescription, en: enDescription } });
export const REWARD_ITEMS = [
  item('quill', 'common', '行者羽笔', "Wanderer's Quill", '把今天的灵感写成旅途的下一页。', 'Turn today’s idea into the next page of your journey.'),
  item('compass', 'rare', '星图罗盘', 'Starbound Compass', '指向那些值得继续探索的声音。', 'Follow the voices worth discovering.'),
  item('key', 'common', '旧城秘钥', 'Old-City Key', '每一次真诚交流，都可能打开一扇门。', 'Every thoughtful conversation may open a door.'),
  item('ring', 'rare', '月影指环', 'Moonshadow Ring', '纪念安静坚持、逐渐发光的日子。', 'A keepsake for the quiet days of steady progress.'),
  item('gem', 'epic', '余烬晶石', 'Ember Crystal', '小小的火种，也有被看见的一天。', 'Even a small spark can one day be seen.'),
  item('scroll', 'common', '誓约卷轴', 'Oath Scroll', '记录与你自己的约定。', 'A record of the promise you made to yourself.'),
  item('chalice', 'epic', '晨曦圣杯', 'Dawn Chalice', '为一次圆满的征途举杯。', 'Raise a toast to a journey well travelled.'),
  item('blade', 'rare', '守望短刃', "Watcher's Blade", '在纷繁的信息里，磨炼清晰的表达。', 'Hone a clear voice amid a world of noise.'),
  item('feather', 'common', '夜鸦之羽', 'Raven Feather', '留给深夜仍然闪烁的灵感。', 'For the ideas that still shine after dark.'),
  item('lantern', 'rare', '引路提灯', "Wayfarer's Lantern", '让下一小步也有光可循。', 'A little light for the next small step.'),
  item('crown', 'epic', '黎明王冠', 'Crown of Dawn', '真正的荣耀，是持续创造自己的作品。', 'There is honour in continuing to create your own work.'),
  item('seal', 'epic', '开拓者印章', "Pioneer's Seal", '为你走过的路，留下独有的印记。', 'Leave your own mark on the path you have travelled.')
];

export function initializeRewards(state, now = new Date()) {
  if (state.rewards?.levelSystem === 'action-v1') return state;
  const level = assessAccount(state).level;
  if (state.rewards) {
    // Preserve actual chests, not an unearned performance-score baseline.
    const awardedLevel = state.rewards.earned.reduce((highest, event) => event.reason === 'level' ? Math.max(highest, event.level) : highest, 1);
    return { ...state, rewards: { ...state.rewards, levelSystem: 'action-v1', levelHighWater: Math.max(level, awardedLevel) } };
  }
  return { ...state, rewards: { version: 1, levelSystem: 'action-v1', initializedAt: now.toISOString(), levelHighWater: level, earned: [] } };
}

function autoComplete(day) {
  if (!day) return false;
  const goals = ['posts', 'replies'].filter(key => day.goals[key] > 0);
  return goals.length > 0 && goals.every(key => (day.auto?.[key] || 0) >= day.goals[key]);
}

export function settleRewards(before, after, action, now = new Date()) {
  const previous = initializeRewards(before, now);
  let next = initializeRewards(after, now);
  if (action.type === 'import') {
    // A restore is never a reward event. Same-account restores cannot undo an
    // already-opened chest or lower the remembered milestone watermark.
    if (before.settings.username === after.settings.username) {
      const saved = new Map(next.rewards.earned.map(event => [event.id, event]));
      for (const event of previous.rewards.earned) {
        const restored = saved.get(event.id);
        if (event.openedAt !== null || restored?.openedAt == null) saved.set(event.id, event);
      }
      const earned = [...saved.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
      if (earned.length > MAX_REWARDS) throw new Error('收藏记录已达到本机上限');
      next = { ...next, rewards: { ...next.rewards, initializedAt: [previous.rewards.initializedAt, next.rewards.initializedAt].sort()[0], levelHighWater: Math.max(previous.rewards.levelHighWater, next.rewards.levelHighWater, assessAccount(next, now).level), earned } };
    } else next = { ...next, rewards: { ...next.rewards, levelHighWater: Math.max(next.rewards.levelHighWater, assessAccount(next, now).level) } };
    return next;
  }
  const rewards = { ...previous.rewards, earned: [...previous.rewards.earned] };
  // A corrected device clock must not create events dated before collection
  // began: those events could neither be opened nor restored from a backup.
  if (now.getTime() < Date.parse(rewards.initializedAt)) return { ...next, rewards };
  const date = dayKey(now, next.settings.timeZone);
  const level = assessAccount(next, now).level;
  const add = event => {
    if (rewards.earned.length < MAX_REWARDS && !rewards.earned.some(saved => saved.id === event.id)) rewards.earned.push({ ...event, openedAt: null, itemId: null });
  };
  // Only local recorded actions earn EXP; Analytics and followers never do.
  const scoreAction = ['network', 'daily', 'adjust'].includes(action.type);
  if (scoreAction && level > assessAccount(previous, now).level) {
    for (let milestone = (Math.floor(rewards.levelHighWater / 5) + 1) * 5; milestone <= level && rewards.earned.length < MAX_REWARDS; milestone += 5) add({ id: `level:${milestone}`, reason: 'level', date, level: milestone });
    rewards.levelHighWater = Math.max(rewards.levelHighWater, level);
  }
  const priorDay = before.days[date], currentDay = next.days[date];
  const newAutomaticAction = ['posts', 'replies'].some(key => (currentDay?.auto?.[key] || 0) > (priorDay?.auto?.[key] || 0));
  if (action.type === 'network' && next.tracking.enabled && newAutomaticAction && !autoComplete(priorDay) && autoComplete(currentDay)) add({ id: `daily:${date}`, reason: 'daily', date });
  return { ...next, rewards };
}

export function openChest(state, id, now = new Date(), random = Math.random) {
  const initialized = initializeRewards(state, now);
  if (id !== undefined && (typeof id !== 'string' || !/^(?:daily:\d{4}-\d{2}-\d{2}|level:\d{1,16})$/.test(id))) throw new Error('无效的宝箱编号');
  const selected = id === undefined ? initialized.rewards.earned.find(event => event.openedAt === null) : initialized.rewards.earned.find(event => event.id === id);
  if (!selected) throw new Error('暂无可开启的宝箱');
  if (selected.openedAt !== null) return initialized;
  if (now.getTime() < Date.parse(initialized.rewards.initializedAt) || dayKey(now, initialized.settings.timeZone) < selected.date) throw new Error('当前设备时间早于收藏记录，请校准时间后重试');
  const owned = new Set(initialized.rewards.earned.map(event => event.itemId).filter(Boolean));
  const unseen = REWARD_ITEMS.filter(entry => !owned.has(entry.id));
  const pool = unseen.length ? unseen : REWARD_ITEMS;
  const roll = random();
  if (typeof roll !== 'number' || !Number.isFinite(roll) || roll < 0 || roll >= 1) throw new Error('无法生成开箱结果，请重试');
  const itemId = pool[Math.floor(roll * pool.length)].id;
  return { ...initialized, rewards: { ...initialized.rewards, earned: initialized.rewards.earned.map(event => event.id === selected.id ? { ...event, openedAt: now.toISOString(), itemId } : event) } };
}

export function rewardsSummary(state) {
  const rewards = initializeRewards(state).rewards;
  const earned = rewards?.earned || [];
  const counts = new Map();
  let latest = null;
  for (const event of earned) if (event.itemId && event.openedAt) {
    counts.set(event.itemId, (counts.get(event.itemId) || 0) + 1);
    if (!latest || event.openedAt >= latest.openedAt) latest = event;
  }
  const items = REWARD_ITEMS.map(entry => ({ ...entry, owned: counts.has(entry.id), count: counts.get(entry.id) || 0 }));
  const nextMilestone = (Math.floor((rewards?.levelHighWater || 1) / 5) + 1) * 5;
  const lastItem = latest ? items.find(entry => entry.id === latest.itemId) : null;
  return { pending: earned.filter(event => event.openedAt === null).length, totalOwned: counts.size, totalItems: items.length, totalEarned: earned.length, items, lastDrop: lastItem ? { ...lastItem, chestId: latest.id, openedAt: latest.openedAt } : null, nextLevel: nextMilestone };
}
