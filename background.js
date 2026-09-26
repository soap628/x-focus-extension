import { STORAGE_KEY, newState, reduce, upgradeState } from './core.js';
import { hudSummary, hudAction } from './hud-state.js';
import { initializeRewards, settleRewards, openChest } from './rewards.js';
import { createLocalBackup } from './local-backup.js';
let queue = Promise.resolve();
const localBackup = createLocalBackup({ chrome, getState: async () => {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const now = new Date();
  return initializeRewards(upgradeState(data[STORAGE_KEY] || newState(), now), now);
} });
const scheduleBackup = state => localBackup.changed(state).catch(() => {});
void localBackup.start().catch(() => {});
chrome.action?.onClicked.addListener(tab => {
  if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'hud-toggle' }).catch(() => {});
});
if (chrome.storage.local.setAccessLevel) chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(console.error);
const config = state => ({ username: state.settings.username, enabled: state.tracking.enabled, startedAt: state.tracking.startedAt });
async function notifyTabs(state) {
  if (!chrome.tabs?.query) return;
  const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://www.x.com/*'] });
  const hud = hudSummary(state);
  await Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: 'config', config: config(state), hud })));
}
chrome.runtime.onInstalled.addListener(() => {
  queue = queue.then(async () => { const data = await chrome.storage.local.get(STORAGE_KEY); const now = new Date(); const state = initializeRewards(upgradeState(data[STORAGE_KEY] || newState(), now), now); await chrome.storage.local.set({ [STORAGE_KEY]: state }); void scheduleBackup(state); }).catch(console.error);
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  // options_ui may open this trusted extension page in a normal tab.
  const fromPanel = sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL('sidepanel.html');
  const fromX = !!sender.tab && /^https:\/\/(www\.)?x\.com\//.test(sender.url || '');
  if (!(fromPanel || (fromX && ['capture', 'network', 'bind', 'heartbeat', 'config', 'hud', 'hud-command'].includes(message.type)))) { respond({ ok: false, error: '不支持的消息来源' }); return; }
  // File controls are available only to our own options page. The X page never
  // receives backup contents, file paths, download IDs or settings access.
  if (fromPanel && ['backup-status', 'backup-now', 'backup-setting', 'backup-show'].includes(message.type)) {
    const work = async () => {
      if (message.type === 'backup-now') return localBackup.runNow();
      if (message.type === 'backup-setting') {
        if (typeof message.enabled !== 'boolean') throw new Error('无效的本地存档设置');
        return localBackup.setEnabled(message.enabled);
      }
      if (message.type === 'backup-show') return localBackup.showFile();
      return localBackup.status();
    };
    work().then(backup => respond({ ok: true, backup }), error => respond({ ok: false, error: error.message || '本地存档暂不可用' }));
    return true;
  }
  const task = async () => {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      const original = data[STORAGE_KEY] || newState();
      const now = new Date();
      const state = initializeRewards(upgradeState(original, now), now);
      if (!original.tracking?.startedAt || original.version !== 2 || !original.account || !Object.hasOwn(original, 'analyticsSummary') || original.rewards?.levelSystem !== 'action-v1' || !original.settings.language || original.hudPreferences === undefined || Object.values(original.days).some(day => !Object.hasOwn(day, 'verifiedFollowers'))) await chrome.storage.local.set({ [STORAGE_KEY]: state });
      if (message.type === 'get') { respond({ ok: true, state }); return; }
      if (['config', 'hud'].includes(message.type)) { respond({ ok: true, config: config(state), hud: hudSummary(state) }); return; }
      if (message.type === 'hud-command' && message.command === 'open-backups') {
        await chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html#backup') });
        respond({ ok: true, config: config(state), hud: hudSummary(state) }); return;
      }
      const action = message.type === 'hud-command' ? hudAction(message, state) : message;
      const next = action.type === 'open-chest' ? openChest(state, action.id, now) : settleRewards(state, reduce(state, action, now), action, now);
      await chrome.storage.local.set({ [STORAGE_KEY]: next });
      // Downloads have their own queue. A slow file dialog or download status
      // lookup must never hold up the committed action ledger or its response.
      if (message.type !== 'heartbeat') void scheduleBackup(next);
      respond(fromPanel ? { ok: true, state: next } : { ok: true, config: config(next), hud: hudSummary(next) });
      if (message.type !== 'heartbeat') void notifyTabs(next).catch(() => {});
    } catch (error) { respond({ ok: false, error: error.message || '无法保存数据' }); }
  };
  queue = queue.then(task, task);
  return true;
});
