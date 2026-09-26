import { STORAGE_KEY, newState, dayKey, ensureDay, recentDates, progress, streak, followerDelta, reduce, csv, validateBackup, upgradeState } from './core.js';
import { createOptionsLocalizer, optionsText, optionsLocale, optionsError, optionsCsv, optionsValidationError } from './options-i18n.js';
const $ = selector => document.querySelector(selector);
const isExtension = !!globalThis.chrome?.runtime?.id;
const demo = !isExtension && new URLSearchParams(location.search).has('demo');
let state = newState(), range = 7, toastTimer, pendingImport, recordBaseline = {}, localQueue = Promise.resolve();
const language = () => state.settings.language === 'en' ? 'en' : 'zh-CN';
const t = (key, values) => optionsText(language(), key, values);
const locale = () => optionsLocale(language());
const localize = createOptionsLocalizer(document);
const visibleErrors = new Map();
let renderedLanguage;
function showError(selector, error) { visibleErrors.set(selector, error); $(selector).textContent = optionsError(language(), error); }
function clearError(selector) { visibleErrors.delete(selector); $(selector).textContent = ''; }
function failure(error) { toast(optionsError(language(), error), true); }
const today = () => dayKey(new Date(), state.settings.timeZone);
const number = value => new Intl.NumberFormat(locale()).format(value);
const shortNumber = value => language() === 'en' ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value) : value >= 10000 ? `${(value / 10000).toFixed(1)}万` : number(value);
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(message, error = false) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').dataset.error = error; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, error ? 6500 : 3300); }
async function readState() {
  if (isExtension) { const response = await chrome.runtime.sendMessage({ type: 'get' }); if (!response?.ok) throw new Error(response?.error || '扩展服务未响应'); return response.state; }
  if (demo) return demoState();
  const saved = localStorage.getItem(STORAGE_KEY); return upgradeState(saved ? validateBackup(JSON.parse(saved)) : newState());
}
function save(action) {
  const task = async () => {
    if (isExtension) {
      const response = await chrome.runtime.sendMessage(action);
      if (!response?.ok) throw new Error(response?.error || '无法保存');
      state = response.state;
    } else {
      const current = demo ? state : await readState();
      const next = reduce(current, action);
      if (!demo) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      state = next;
    }
    render();
  };
  const pending = localQueue.then(task, task); localQueue = pending.catch(() => {}); return pending;
}
function demoState() {
  let result = newState(); result.settings.username = 'your_handle';
  const dates = recentDates(dayKey(), 7);
  const followers = [128, 134, 139, 145, 157, 164, 176];
  dates.forEach((date, i) => { const d = ensureDay(result, date); d.posts = i === 6 ? 1 : 2; d.replies = i === 6 ? 6 : 10 + i; d.followers = { value: followers[i], approximate: false, source: 'page', at: `${date}T01:00:00Z` }; d.impressions = { value: [840, 1220, 980, 1850, 2140, 2980, 1648][i], source: 'manual', approximate: false, at: `${date}T01:00:00Z` }; });
  for (const [index, d] of Object.values(result.days).entries()) { d.auto = { posts: d.posts, replies: d.replies }; d.trackedViews = [621, 956, 788, 1532, 1833, 2401, 1276][index]; d.trackedIds = ['100', '101', '102']; d.impressions.source = 'analytics'; d.followers.source = 'network'; }
  result.lastCapture = new Date().toISOString(); result.tracking.startedAt = `${dates[0]}T00:00:00Z`; result.tracking.lastNetworkAt = result.lastCapture; result.tracking.lastPageAt = result.lastCapture; return result;
}
function render() {
  if (renderedLanguage && renderedLanguage !== language()) $('#toast').hidden = true;
  renderedLanguage = language(); localize(language());
  $('#language-select').value = language();
  for (const input of document.querySelectorAll('input, textarea')) if (input.validity?.customError) input.setCustomValidity(optionsValidationError(language(), input));
  for (const [selector, error] of visibleErrors) $(selector).textContent = optionsError(language(), error);
  if (!isExtension) { $('#preview-banner').hidden = false; $('#preview-banner').textContent = t(demo ? '示例预览 · 以下为虚构数据 · 不写入扩展记录' : '本地预览 · 数据仅保存在此预览，扩展数据独立存储'); }
  renderImportSummary();
  const date = today(); const d = state.days[date] || { posts: 0, replies: 0, goals: { posts: state.settings.posts, replies: state.settings.replies } };
  const p = progress(d);
  $('#account-label').textContent = state.settings.username ? t('@{name} 的起号日常', { name: state.settings.username }) : t('你的 X 起号日常');
  $('#today-date').textContent = new Intl.DateTimeFormat(locale(), { timeZone: state.settings.timeZone, month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  $('#streak').textContent = t('连续 {days} 天', { days: streak(state, date) });
  $('#progress-ring').style.setProperty('--progress', `${p.percent}%`);
  $('#progress-number').innerHTML = `${p.percent}<small>%</small>`;
  const left = { posts: Math.max(0, d.goals.posts - d.posts), replies: Math.max(0, d.goals.replies - d.replies) };
  $('#remaining').textContent = t(!p.enabled ? '今天，按自己的节奏' : p.complete ? '今日目标，已完成 ✓' : d.posts + d.replies ? '已经在向前了' : '从第一条开始');
  $('#hero-subtitle').textContent = !p.enabled ? t('两项目标已暂停，仍可记录行动。') : p.complete ? t('留下一点复盘，明天继续积累。') : t('还差 {posts} 条发帖 · {replies} 条回复', left);
  for (const [kind, prefix] of [['posts', 'post'], ['replies', 'reply']]) {
    $(`#${prefix}-count`).textContent = d[kind]; $(`#${prefix}-goal`).textContent = d.goals[kind] ? ` / ${d.goals[kind]}` : t(' / 已暂停');
    $(`#${prefix}-bar`).style.width = `${d.goals[kind] ? Math.min(100, d[kind] / d.goals[kind] * 100) : 0}%`;
    $(`[data-adjust="${kind}:-1"]`).disabled = d[kind] === 0;
  }
  $('#auto-count-summary').textContent = t('自动识别 {posts} 条发帖 · {replies} 条回复 · ± 可修正', { posts: d.auto?.posts || 0, replies: d.auto?.replies || 0 });
  const lastDate = Object.keys(state.days).filter(key => key <= date && state.days[key].followers).sort().at(-1);
  const followers = lastDate && state.days[lastDate].followers;
  $('#followers-value').textContent = followers ? `${followers.approximate ? '≈' : ''}${number(followers.value)}` : '—';
  const delta = lastDate && followerDelta(state, lastDate);
  const deltaEl = $('#followers-delta'); deltaEl.className = delta ? delta.value >= 0 ? 'positive' : 'negative' : '';
  deltaEl.textContent = !followers ? t('等待第一笔记录') : lastDate !== date ? t('最近记录于 {date}，今天未更新', { date: lastDate.slice(5) }) : delta ? t('{approx}{value} · 较 {date} 记录', { approx: delta.approximate ? t('约 ') : '', value: `${delta.value >= 0 ? '+' : ''}${number(delta.value)}`, date: delta.previousDate.slice(5) }) : t('已建立起点 · 下次记录可比较');
  $('#followers-source').textContent = followers ? `${t(followers.source === 'manual' ? '手动记录' : followers.source === 'network' ? 'X 页面数据' : '页面读取')} · ${formatTime(followers.at)}` : '';
  $('#impressions-value').textContent = d.impressions ? `${d.impressions.approximate ? '≈' : ''}${number(d.impressions.value)}` : '—';
  $('#impressions-meta').textContent = d.impressions ? `${t(d.impressions.source === 'analytics' ? '分析页自动读取' : '手动填写')} · ${formatTime(d.impressions.at)}` : t('打开分析页，选择“今天”后自动读取');
  $('#tracked-views-value').textContent = d.trackedViews == null ? '—' : `+${number(d.trackedViews)}`;
  $('#tracked-views-meta').textContent = d.trackedViews == null ? t('只累计已采集帖子的可确认增量') : t('今天跟踪 {count} 条 · 非全账号曝光', { count: d.trackedIds?.length || 0 });
  $('#today-note').textContent = d.note || t('今天哪条内容、哪次对话值得继续？');
  $('#note-button').textContent = t(d.note ? '编辑今日复盘 ↗' : '写下今日复盘 ↗');
  const tracking = state.tracking || newState().tracking;
  $('#tracking-title').textContent = t(tracking.enabled ? '本机自动统计已开启' : '自动统计已暂停');
  $('#tracking-button').textContent = t(tracking.enabled ? '暂停' : '恢复');
  const connected = tracking.lastPageAt && Date.now() - Date.parse(tracking.lastPageAt) < 150000;
  $('#capture-status').textContent = !tracking.enabled ? t('恢复后从新的时间点继续计数，已保存记录保留。') : !state.settings.username ? t('打开 X 后自动识别你的账号，也可在设置中填写。') : connected ? (tracking.lastNetworkAt ? t('最近接收 X 数据 {time}。发布成功后自动更新，历史重复记录会去重。', { time: formatTime(tracking.lastNetworkAt) }) : t('已连接 X 页面，等待下一次发布或数据更新。')) : t('等待连接。请刷新 Edge 中的 X 页面，扩展会从启用时开始自动统计。');
  renderGrowth();
}
function formatTime(value) { return Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(locale(), { timeZone: state.settings.timeZone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—'; }
function renderGrowth() {
  const dates = recentDates(today(), range);
  const records = dates.map(date => state.days[date]).filter(Boolean);
  $('#summary-posts').textContent = number(records.reduce((a, d) => a + d.posts, 0));
  $('#summary-replies').textContent = number(records.reduce((a, d) => a + d.replies, 0));
  $('#summary-complete').textContent = records.filter(d => progress(d).complete).length;
  $('#follower-trend-meta').textContent = t('已记录 {count} / {range} 天', { count: records.filter(d => d.followers).length, range });
  chart($('#followers-chart'), dates, 'followers'); chart($('#impressions-chart'), dates, 'impressions'); chart($('#tracked-views-chart'), dates, 'trackedViews');
  const rows = dates.toReversed().filter(date => state.days[date]);
  $('#history').innerHTML = rows.length ? `<div class="history-row heading">${['日期', '发帖 / 回复', '粉丝', '当日曝光'].map(key => `<span>${escape(t(key))}</span>`).join('')}</div>` + rows.map(date => {
    const d = state.days[date]; return `<button class="history-row" data-date="${date}" aria-label="${escape(t('编辑 {date} 记录', { date }))}"><span>${date.slice(5)} ${progress(d).complete ? '<small>✓</small>' : ''}</span><span>${d.posts} / ${d.replies}</span><span>${d.followers ? (d.followers.approximate ? '≈' : '') + shortNumber(d.followers.value) : '—'}</span><span>${d.impressions ? shortNumber(d.impressions.value) : '—'}</span></button>`;
  }).join('') : `<div class="empty-box">${escape(t('记录第一天，开始积累自己的数据。'))}</div>`;
  const posts = Object.values(state.posts).sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  $('#captured-count').textContent = t('{count} 条', { count: posts.length });
  $('#captured-posts').innerHTML = posts.length ? posts.slice(0, 20).map(post => `<a class="post-card" href="https://x.com/${encodeURIComponent(state.settings.username)}/status/${encodeURIComponent(post.id)}" target="_blank" rel="noopener noreferrer"><p>${escape(post.text)}</p><div><span>${escape(t('{time} 采集', { time: formatTime(post.observedAt) }))}</span><b>${escape(post.views == null ? t('浏览量待更新') : t('{approx}{value} 次累计浏览', { approx: post.approximate ? '≈' : '', value: number(post.views) }))} ↗</b></div></a>`).join('') + (posts.length > 20 ? `<p class="help-text">${escape(t('显示最近 20 条；全部记录随 JSON 备份保存。'))}</p>` : '') : `<div class="empty-box">${escape(t('浏览自己的帖子时，会逐步积累浏览数据。'))}<br>${escape(t('尚未采集的数据不会记成 0。'))}</div>`;
}
function chart(target, dates, field) {
  const label = t(field === 'followers' ? '粉丝' : field === 'trackedViews' ? '跟踪帖浏览增量' : '曝光');
  const values = dates.map(date => { const value = state.days[date]?.[field]; return field === 'trackedViews' ? value == null ? null : { value, approximate: false } : value; });
  const existing = values.filter(Boolean);
  if (!existing.length) { target.innerHTML = `<div class="chart-empty">${escape(t('还没有{label}记录', { label }))}<br>${escape(t('从今天的第一笔开始'))}</div>`; return; }
  const width = 360, height = 138, left = 44, right = 10, top = 10, bottom = 25;
  let min = field === 'followers' ? Math.min(...existing.map(v => v.value)) : 0;
  let max = Math.max(...existing.map(v => v.value));
  if (min === max) { min = Math.max(0, min - 2); max += 2; }
  const x = index => left + index / (dates.length - 1) * (width - left - right);
  const y = value => top + (max - value) / (max - min) * (height - top - bottom);
  let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(t('近 {range} 天{label}趋势，缺失日期不记为零', { range, label }))}">`;
  for (const value of [min, (min + max) / 2, max]) svg += `<line x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}" stroke="#e9ede4" stroke-dasharray="3 4"/><text x="${left - 7}" y="${y(value) + 3}" text-anchor="end" fill="#96a08c" font-size="8">${shortNumber(Math.round(value))}</text>`;
  values.forEach((metric, i) => {
    if (!metric) return;
    if (field === 'followers') {
      if (i && values[i - 1]) svg += `<line x1="${x(i - 1)}" y1="${y(values[i - 1].value)}" x2="${x(i)}" y2="${y(metric.value)}" stroke="#6e905b" stroke-width="2"/>`;
      svg += `<circle cx="${x(i)}" cy="${y(metric.value)}" r="3.5" fill="#547644" stroke="white" stroke-width="1.5"><title>${escape(t('{date}：{approx}{value} {label}', { date: dates[i], approx: metric.approximate ? t('约 ') : '', value: number(metric.value), label }))}</title></circle>`;
    } else svg += `<rect x="${x(i) - Math.min(8, 100 / range)}" y="${y(metric.value)}" width="${Math.min(16, 200 / range)}" height="${Math.max(1, y(0) - y(metric.value))}" rx="2" fill="#b7c99b"><title>${escape(t('{date}：{approx}{value} {label}', { date: dates[i], approx: metric.approximate ? t('约 ') : '', value: number(metric.value), label }))}</title></rect>`;
  });
  for (const i of [0, Math.floor((dates.length - 1) / 2), dates.length - 1]) svg += `<text x="${x(i)}" y="${height - 5}" text-anchor="middle" fill="#929e89" font-size="8">${dates[i].slice(5)}</text>`;
  const list = existing.length;
  target.innerHTML = svg + `</svg><div class="chart-caption">${escape(t('{count} 天有记录 · 空白表示缺失', { count: list }) + (existing.some(m => m.approximate) ? t(' · 含页面近似值') : '') + t(' · 悬停查看数值'))}</div>`;
}
function openSettings() {
  const form = $('#settings-form'); for (const key of ['username', 'posts', 'replies']) form.elements[key].value = state.settings[key];
  clearError('#settings-error'); $('#settings-dialog').showModal();
}
function fillRecord(date) {
  const d = state.days[date]; const form = $('#record-form');
  form.elements.date.value = date; form.elements.date.max = today();
  for (const key of ['posts', 'replies']) form.elements[key].value = d?.[key] ?? '';
  for (const key of ['followers', 'impressions']) form.elements[key].value = d?.[key]?.approximate ? '' : d?.[key]?.value ?? '';
  recordBaseline = Object.fromEntries(['posts', 'replies', 'followers', 'impressions'].map(key => [key, form.elements[key].value]));
  form.elements.note.value = d?.note || ''; clearError('#record-error');
}
function openRecord(date = today()) { fillRecord(date); $('#record-dialog').showModal(); }
function download(name, contents, type) { const url = URL.createObjectURL(new Blob([contents], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
function backup() { download(`x-focus-${state.settings.username || 'local'}-${today()}.json`, JSON.stringify(state, null, 2), 'application/json'); }
function renderImportSummary() { if (pendingImport) $('#import-summary').textContent = t('将恢复 @{name} 的 {days} 天记录和 {posts} 条帖子。', { name: pendingImport.settings.username || t('未绑定账号'), days: Object.keys(pendingImport.days).length, posts: Object.keys(pendingImport.posts).length }); }
$('#language-select').addEventListener('change', async event => {
  const select = event.currentTarget, next = select.value; select.disabled = true;
  try { await save({ type: 'language', language: next }); toast(t('语言已保存')); }
  catch (error) { select.value = language(); failure(error); }
  finally { select.disabled = false; }
});
for (const input of document.querySelectorAll('input, textarea')) {
  if (typeof input.setCustomValidity !== 'function') continue;
  input.addEventListener('invalid', () => input.setCustomValidity(optionsValidationError(language(), input)));
  input.addEventListener('input', () => input.setCustomValidity(''));
}
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-tab]').forEach(tab => { const selected = tab === button; tab.classList.toggle('selected', selected); tab.setAttribute('aria-selected', String(selected)); });
  $('#today-page').hidden = button.dataset.tab !== 'today'; $('#growth-page').hidden = button.dataset.tab !== 'growth';
}));
document.querySelectorAll('[data-range]').forEach(button => button.addEventListener('click', () => { range = Number(button.dataset.range); document.querySelectorAll('[data-range]').forEach(b => b.classList.toggle('selected', b === button)); renderGrowth(); }));
document.querySelectorAll('[data-adjust]').forEach(button => button.addEventListener('click', async () => {
  const [kind, amount] = button.dataset.adjust.split(':'); button.disabled = true;
  try { await save({ type: 'adjust', kind, amount: Number(amount) }); toast(Number(amount) > 0 ? t('已记录 1 条{kind}', { kind: t(kind === 'posts' ? '发帖' : '回复') }) : t('已减去 1 条')); } catch (error) { failure(error); } finally { button.disabled = false; render(); }
}));
$('#settings-button').addEventListener('click', openSettings);
$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget;
  try { await save({ type: 'settings', username: form.elements.username.value, posts: Number(form.elements.posts.value), replies: Number(form.elements.replies.value) }); $('#settings-dialog').close(); toast(t('目标已保存，从今天开始')); } catch (error) { showError('#settings-error', error); }
});
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
for (const id of ['record-button', 'history-record-button', 'note-button']) $(`#${id}`).addEventListener('click', () => openRecord());
$('#history').addEventListener('click', event => { const row = event.target.closest('[data-date]'); if (row) openRecord(row.dataset.date); });
$('#record-form').elements.date.addEventListener('change', event => { if (event.target.value) fillRecord(event.target.value); });
$('#record-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget;
  const action = { type: 'daily', date: form.elements.date.value, note: form.elements.note.value };
  for (const key of ['posts', 'replies', 'followers', 'impressions']) action[key] = form.elements[key].value === '' || form.elements[key].value === recordBaseline[key] ? null : Number(form.elements[key].value);
  try { await save(action); $('#record-dialog').close(); toast(t('记录已保存')); } catch (error) { showError('#record-error', error); }
});
$('#profile-button').addEventListener('click', () => { if (!state.settings.username) return openSettings(); const url = `https://x.com/${state.settings.username}`; if (isExtension) chrome.tabs.create({ url }); else window.open(url, '_blank', 'noopener'); });
$('#analytics-button').addEventListener('click', () => { const url = 'https://x.com/i/account_analytics'; if (isExtension) chrome.tabs.create({ url }); else window.open(url, '_blank', 'noopener'); });
$('#tracking-button').addEventListener('click', async () => { try { await save({ type: 'tracking', enabled: !state.tracking.enabled }); toast(t(state.tracking.enabled ? '自动统计已恢复' : '自动统计已暂停')); } catch (error) { failure(error); } });
$('#scan-button').addEventListener('click', async () => {
  if (!state.settings.username) return openSettings();
  if (!isExtension) { toast(t('此处是界面预览。安装扩展后可读取 X 页面。')); return; }
  $('#scan-button').disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !/^https:\/\/(www\.)?x\.com\//.test(tab.url || '')) throw new Error('请在当前窗口打开你的 X 个人主页，再点读取页面');
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'scan' });
    if (result?.error) throw new Error(result.error);
    state = await readState(); render();
    toast(result?.followers || result?.count || result?.analytics ? [t('已读取'), result.followers ? t('粉丝数') : '', result.count ? t('{count} 条帖子', { count: result.count }) : '', result.analytics ? t('{count} 天曝光', { count: result.analytics }) : ''].filter(Boolean).join(' · ') : t('尚无可识别数据。分析页请选择“今天”，或打开本人主页等待加载。'));
  } catch (error) { failure(/receiving end|connection/i.test(error.message) ? new Error('请刷新 X 页面，让新安装的扩展开始工作') : error); } finally { $('#scan-button').disabled = false; }
});
$('#export-csv').addEventListener('click', () => download(`x-focus-${today()}.csv`, optionsCsv(csv(state), language()), 'text/csv;charset=utf-8'));
$('#export-json').addEventListener('click', backup);
$('#import-button').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('备份文件应小于 5 MB');
    pendingImport = validateBackup(JSON.parse(await file.text()));
    renderImportSummary();
    $('#confirm-import').disabled = true; clearError('#import-error'); $('#import-dialog').showModal();
  } catch (error) { toast(t('无法恢复：{error}', { error: optionsError(language(), error) }), true); } finally { event.target.value = ''; }
});
$('#backup-before-import').addEventListener('click', () => { backup(); $('#confirm-import').disabled = false; });
$('#confirm-import').addEventListener('click', async () => { try { await save({ type: 'import', data: pendingImport }); $('#import-dialog').close(); toast(t('备份已恢复')); } catch (error) { showError('#import-error', error); } });
if (isExtension) chrome.storage.onChanged.addListener(changes => { if (changes[STORAGE_KEY]?.newValue) { state = changes[STORAGE_KEY].newValue; render(); } });
else window.addEventListener('storage', event => { if (!demo && event.key === STORAGE_KEY) readState().then(next => { state = next; render(); }).catch(failure); });
setInterval(render, 30000);
try { state = await readState(); render(); } catch (error) { localize(language()); toast(t('读取数据失败：{error}。请先备份现有数据再处理。', { error: optionsError(language(), error) }), true); document.querySelectorAll('button, select').forEach(button => { button.disabled = true; }); }
