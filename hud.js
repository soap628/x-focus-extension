(() => {
  const WIDTH = 232, MINI_WIDTH = 184, GAP = 16, EDGE = 4, SNAP = 24;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function resolveLayout({ viewportWidth, viewportHeight, width, height, position, bounds }) {
    const vw = Math.max(1, viewportWidth || 1), vh = Math.max(1, viewportHeight || 1);
    const edge = Math.min(EDGE, vw / 2, vh / 2);
    width = Math.max(1, Math.min(width, vw - edge * 2));
    height = Math.max(1, Math.min(height, vh - edge * 2));
    const rangeX = Math.max(0, vw - width - edge * 2), rangeY = Math.max(0, vh - height - edge * 2);
    const anchor = position?.anchor || (bounds && vw - bounds.right < width + GAP && bounds.left >= width + GAP ? 'left' : 'right');
    const left = anchor === 'left' ? edge : anchor === 'right' ? edge + rangeX : edge + clamp(position?.x || 0, 0, 1) * rangeX;
    const top = position ? edge + clamp(position.y || 0, 0, 1) * rangeY : clamp(108, edge, edge + rangeY);
    return { left, top, anchor, width, height };
  }
  function placement(viewport, bounds) {
    if (!bounds || viewport < WIDTH + GAP * 2) return { mode: 'compact', left: Math.max(8, viewport - 64) };
    const right = viewport - bounds.right;
    if (right >= WIDTH + GAP * 2) return { mode: 'right', left: bounds.right + (right - WIDTH) / 2 };
    if (bounds.left >= WIDTH + GAP * 2) return { mode: 'left', left: (bounds.left - WIDTH) / 2 };
    return { mode: 'compact', left: Math.max(8, viewport - 64) };
  }
  const { css, crest, emblem, quill, reply, gear } = globalThis.XFocusTheme;
  function mount({ onCommand, getBounds } = {}) {
    if (document.getElementById('x-focus-hud')) return null;
    const host = document.createElement('div'); host.id = 'x-focus-hud';
    const shadow = host.attachShadow({ mode: 'open' });
    const chestUrl = globalThis.chrome?.runtime?.getURL ? globalThis.chrome.runtime.getURL('assets/treasure-chest-v1.png') : 'assets/treasure-chest-v1.png';
    shadow.innerHTML = [
      '<style>' + css + '</style><aside class="hud" data-i18n-aria="hud"><div class="card" hidden>',
      '<div class="heading" tabindex="0" data-i18n-aria="dragHint"><span class="brand-mark">' + emblem + '</span><b data-i18n="title"></b><div class="controls"><button class="icon settings-toggle" data-i18n-aria="settings" aria-expanded="false">' + gear + '</button><button class="icon minimize" data-i18n-aria="collapse"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10"/></svg></button></div></div>',
      '<div class="hero">' + crest + '<div class="identity"><div class="hero-line"><span class="name"></span><span class="verified-badge" data-i18n-aria="verified" hidden>✓</span></div><div class="rank"></div><button class="level-row assessment-toggle" data-i18n-aria="assessmentButton" aria-expanded="false"><span class="level">LV. 01</span><span class="rank-stars" aria-hidden="true">✧</span><span class="level-detail" data-i18n="details"></span></button></div><span class="hero-spark" aria-hidden="true">✧</span></div>',
      '<div class="xp-row"><span data-i18n="growth"></span><div class="track" role="progressbar" data-i18n-aria="growthProgress" aria-valuemin="0" aria-valuemax="100"><div class="fill"></div></div><span class="xp-num"></span></div>',
      '<section class="assessment-panel" hidden><div class="assessment-heading"><h3 data-i18n="actionGrowth"></h3><span class="assessment-score"></span></div><p class="assessment-coverage"></p><div class="dimensions"></div><p class="assessment-xp"></p><details class="score-rules"><summary data-i18n="scoringRules"></summary><p data-i18n="rule1"></p><p data-i18n="rule2"></p><p data-i18n="rule3"></p></details></section>',
      '<div class="quest-heading"><span data-i18n="quests"></span><span class="quest-total">0 / 2</span></div>',
      '<div class="quest" data-kind="posts" style="--bar:#d94134;--bar-dark:#6b130e;--glow:#da31273d"><div class="quest-line"><span class="quest-icon">' + quill + '</span><span class="quest-name" data-i18n="posts"></span><span class="quest-reward">+5 EXP</span><span class="count"></span></div><div class="track" role="progressbar" data-i18n-aria="postsToday" aria-valuemin="0"><div class="fill"></div></div></div>',
      '<div class="quest" data-kind="replies" style="--bar:#398fcb;--bar-dark:#123956;--glow:#328bdd40"><div class="quest-line"><span class="quest-icon">' + reply + '</span><span class="quest-name" data-i18n="replies"></span><span class="quest-reward">+1 EXP</span><span class="count"></span></div><div class="track" role="progressbar" data-i18n-aria="repliesToday" aria-valuemin="0"><div class="fill"></div></div></div>',
      '<div class="completion" hidden><span class="seal">' + emblem + '</span><span data-i18n="completed"></span></div>',
      '<div class="metrics"><div class="followers"><span class="metric-label"></span><span class="metric-value">—</span><span class="delta"></span></div><div class="verified-followers"><span class="metric-label" data-i18n="verifiedFollowers"></span><span class="metric-value">—</span></div><div class="views"><span class="metric-label"></span><span class="metric-value">—</span></div><div class="engagements"><span class="metric-label"></span><span class="metric-value">—</span></div></div>',
      '<button class="treasure-strip inventory-toggle" data-i18n-aria="collectionButton" aria-expanded="false"><img class="treasure-chest" alt=""><span class="treasure-copy"><b data-i18n="collection"></b><span class="collection-count"></span></span><span class="chest-count"></span><span class="treasure-chevron" aria-hidden="true">›</span></button>',
      '<section class="inventory-panel" hidden><div class="inventory-intro"><span class="inventory-caption"></span><span class="collection-total"></span></div><button class="open-chest" type="button"></button><p class="next-reward"></p><div class="relic-grid"></div><div class="item-detail" role="status" hidden><span class="item-emblem" aria-hidden="true"></span><div class="item-rarity"></div><h3 class="item-name"></h3><p class="item-description"></p><span class="item-count"></span></div><p class="loot-help" data-i18n="lootRules"></p></section>',
      '<div class="footer"><span class="date"></span><button class="connection-toggle" data-i18n-aria="statusButton" aria-expanded="false"><span class="live"></span><span class="status"></span></button></div>',
      '<section class="connection-panel" hidden><h3 data-i18n="statusButton"></h3><p class="connection-message"></p><dl><dt data-i18n="boundAccount"></dt><dd class="connection-account"></dd><dt data-i18n="latestData"></dt><dd class="connection-time"></dd><dt data-i18n="detectedToday"></dt><dd class="connection-actions"></dd><dt data-i18n="ownBlue"></dt><dd class="connection-verified"></dd></dl><button class="scan-now save" type="button" data-i18n="scan"></button><p class="help" data-i18n="captureHelp"></p></section>',
      '<section class="settings" hidden><h3 data-i18n="dailySettings"></h3><form><div class="fields"><label><span data-i18n="postGoal"></span><input name="posts" type="number" min="0" max="1000" step="1" required></label><label><span data-i18n="replyGoal"></span><input name="replies" type="number" min="0" max="1000" step="1" required></label></div><button class="save" type="submit" data-i18n="save"></button></form>',
      '<label class="language-field"><span data-i18n="language"></span><select class="language-select" data-i18n-aria="language"><option value="zh-CN">简体中文</option><option value="en">English</option></select></label>',
      '<div class="panel-position"><span data-i18n="panelPosition"></span><div class="position-controls"><button class="dock-left" type="button" data-i18n="dockLeft"></button><button class="dock-right" type="button" data-i18n="dockRight"></button><button class="position-auto" type="button" data-i18n="autoPosition"></button></div><p class="layout-help" data-i18n="layoutHelp"></p></div>',
      '<div class="correct"><span data-i18n="correctPosts"></span><button data-kind="posts" data-amount="-1" data-i18n-aria="postsMinus">−</button><button data-kind="posts" data-amount="1" data-i18n-aria="postsPlus">+</button></div><div class="correct"><span data-i18n="correctReplies"></span><button data-kind="replies" data-amount="-1" data-i18n-aria="repliesMinus">−</button><button data-kind="replies" data-amount="1" data-i18n-aria="repliesPlus">+</button></div>',
      '<div class="settings-links"><a class="profile-link" href="https://x.com/" target="_blank" rel="noopener noreferrer" data-i18n="profileLink"></a><a href="https://x.com/i/account_analytics" target="_blank" rel="noopener noreferrer" data-i18n="analyticsLink"></a></div><button class="text-btn tracking-toggle" type="button"></button><p class="help" data-i18n="settingsHelp"></p></section>',
      '<div class="error" role="alert" hidden></div><div class="toast" role="status" hidden></div><div class="reward-float" role="status" hidden></div></div><button class="orb" data-i18n-aria="expand" hidden><span class="orb-emblem">' + emblem + '</span><span class="orb-level">01</span><span class="orb-loot" hidden></span><i></i></button></aside>'
    ].join('');
    (document.body || document.documentElement).append(host);
    const $ = selector => shadow.querySelector(selector);
    $('.treasure-chest').src = chestUrl;
    let model, toastTimer, rewardTimer, drag = null, renderedLayout = null, layoutDraft = null;
    let preferenceQueue = Promise.resolve(), preferenceRevision = 0, destroyed = false;
    let selectedItem = null, chestBusy = false, scanBusy = false, languageBusy = false;
    let currentError = null, toastKey = null, currentReward = null, inventorySignature = '';
    let connection = { status: 'connecting', code: 'config' };
    const lang = () => model?.language === 'en' ? 'en' : 'zh-CN';
    const t = (key, params) => globalThis.XFocusI18n.t(lang(), key, params);
    const compactNumber = n => Math.abs(n) < 10000 ? n.toLocaleString('en-US') : Math.abs(n) < 1e6 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'm';
    const approximate = value => value.approximate ? '≈' : '';
    const sourceCodes = new Set(['stopped', 'transport', 'config', 'paused', 'mismatch', 'identity', 'handshake-timeout', 'handshake', 'ready', 'demo']);
    function translatedError(error) {
      if (sourceCodes.has(error?.code) && !['config', 'handshake', 'ready', 'demo'].includes(error.code)) return t('conn_' + error.code, connection.params);
      return lang() === 'zh-CN' && error?.message ? error.message : t('failed');
    }
    function translateStatic() {
      $('.hud').setAttribute('lang', lang());
      shadow.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.getAttribute('data-i18n')); });
      shadow.querySelectorAll('[data-i18n-aria]').forEach(node => { node.setAttribute('aria-label', t(node.getAttribute('data-i18n-aria'))); });
      $('.language-select').value = lang();
      if (currentError) $('.error').textContent = translatedError(currentError);
      if (toastKey) $('.toast').textContent = t(toastKey);
      if (currentReward) $('.reward-float').textContent = currentReward.level ? t('levelUp', { level: currentReward.level }) : '+' + currentReward.gain + ' EXP';
    }
    function defaultBounds() {
      const primary = document.querySelector('[data-testid="primaryColumn"]');
      const nodes = [primary, document.querySelector('[data-testid="sidebarColumn"]'), document.querySelector('header nav, [role="banner"] nav')].filter(Boolean);
      if (!primary) nodes.push(document.querySelector('main'));
      const rects = nodes.filter(Boolean).map(node => node.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0);
      return rects.length ? { left: Math.min(...rects.map(rect => rect.left)), right: Math.max(...rects.map(rect => rect.right)) } : null;
    }
    function preferences() { return { mode: 'mini', position: null, ...model?.hudPreferences, ...layoutDraft }; }
    function viewport() {
      const width = window.innerWidth || 1920, height = window.innerHeight || 800;
      return { width: Math.min(width, document.documentElement.clientWidth || width), height: Math.min(height, document.documentElement.clientHeight || height) };
    }
    function layout() {
      if (destroyed) return;
      const prefs = preferences(), mini = prefs.mode === 'mini', hud = $('.hud'), card = $('.card');
      hud.classList.toggle('mini', mini); hud.classList.remove('compact');
      card.hidden = !model; $('.orb').hidden = true;
      const { width: vw, height: vh } = viewport();
      const width = Math.min(mini ? MINI_WIDTH : WIDTH, Math.max(1, vw - EDGE * 2));
      hud.style.width = width + 'px'; card.style.width = '100%'; card.style.right = '';
      card.style.maxHeight = Math.max(1, vh - EDGE * 2) + 'px'; card.style.overflowY = 'auto'; card.style.overflowX = 'hidden';
      $('.heading b').textContent = t(mini ? 'quests' : 'title');
      $('.heading').title = t('dragHint');
      $('.settings-toggle').hidden = mini;
      $('.minimize').setAttribute('aria-label', t(mini ? 'fullMode' : 'miniMode'));
      $('.minimize').setAttribute('aria-expanded', String(!mini));
      $('.minimize').title = t(mini ? 'fullMode' : 'miniMode');
      $('.minimize path').setAttribute('d', mini ? 'M3 6 8 11 13 6M3 2 8 7 13 2' : 'M3 8h10');
      const height = card.getBoundingClientRect().height || (mini ? 140 : 620);
      let pos = resolveLayout({ viewportWidth: vw, viewportHeight: vh, width, height, position: prefs.position, bounds: (getBounds || defaultBounds)() });
      if (drag?.moved) pos = { ...pos, left: clamp(drag.left, EDGE, Math.max(EDGE, vw - pos.width - EDGE)), top: clamp(drag.top, EDGE, Math.max(EDGE, vh - pos.height - EDGE)), anchor: 'free' };
      renderedLayout = pos;
      hud.style.left = pos.left + 'px'; hud.style.top = pos.top + 'px'; hud.style.right = 'auto';
      hud.classList.toggle('docked-left', pos.anchor === 'left'); hud.classList.toggle('docked-right', pos.anchor === 'right');
      $('.dock-left').setAttribute('aria-pressed', String(prefs.position?.anchor === 'left'));
      $('.dock-right').setAttribute('aria-pressed', String(prefs.position?.anchor === 'right'));
      $('.position-auto').setAttribute('aria-pressed', String(prefs.position === null));
    }
    function positionAt(left, top, snap = true) {
      const size = renderedLayout || { width: MINI_WIDTH, height: 140 };
      const area = viewport();
      const rangeX = Math.max(0, area.width - size.width - EDGE * 2), rangeY = Math.max(0, area.height - size.height - EDGE * 2);
      const x = rangeX ? clamp((left - EDGE) / rangeX, 0, 1) : 0, y = rangeY ? clamp((top - EDGE) / rangeY, 0, 1) : 0;
      const anchor = snap && left - EDGE <= SNAP ? 'left' : snap && EDGE + rangeX - left <= SNAP ? 'right' : 'free';
      return { anchor, x: anchor === 'left' ? 0 : anchor === 'right' ? 1 : x, y };
    }
    function savePreferences(patch) {
      if (!model || destroyed) return Promise.resolve();
      const revision = ++preferenceRevision;
      layoutDraft = { ...layoutDraft, ...patch };
      if (patch.mode === 'mini') closePanels();
      layout();
      preferenceQueue = preferenceQueue.then(async () => {
        if (destroyed) return;
        await command({ command: 'hud-preferences', preferences: patch });
        if (revision === preferenceRevision) { layoutDraft = null; layout(); }
      });
      return preferenceQueue;
    }
    function renderConnection() {
      const status = connection.status || 'connecting';
      const statusKey = 'status_' + status;
      $('.status').textContent = t(statusKey) === statusKey ? t('status_connecting') : t(statusKey);
      $('.connection-toggle').className = 'connection-toggle ' + (status === 'error' ? 'error-state' : status);
      const fallbackCodes = { connecting: 'config', ready: 'ready', 'waiting-account': 'identity', 'account-mismatch': 'mismatch', paused: 'paused', error: 'stopped', demo: 'demo' };
      const code = sourceCodes.has(connection.code) ? connection.code : fallbackCodes[status] || 'config';
      const message = lang() === 'zh-CN' && !connection.code && connection.message ? connection.message : t('conn_' + code, connection.params);
      $('.connection-toggle').title = message; $('.connection-message').textContent = message;
      $('.connection-account').textContent = model?.username ? '@' + model.username : t('awaiting');
      const time = model?.tracking?.lastNetworkAt;
      $('.connection-time').textContent = time && Number.isFinite(Date.parse(time)) ? new Intl.DateTimeFormat(lang(), { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(time)) : t('neverReceived');
      $('.connection-actions').textContent = t('autoActions', { posts: model?.auto?.posts || 0, replies: model?.auto?.replies || 0 });
      $('.connection-verified').textContent = t(model?.blueVerified ? (model.blueVerified.value ? 'isVerified' : 'notVerified') : 'unknownVerified');
      $('.scan-now').textContent = t(scanBusy ? 'scanning' : 'scan');
      $('.scan-now').disabled = scanBusy || !model?.enabled || ['paused', 'account-mismatch', 'waiting-account', 'error', 'connecting'].includes(status);
      $('.scan-now').setAttribute('aria-busy', String(scanBusy));
    }
    function setConnection(next) { connection = next || { status: 'connecting', code: 'config' }; renderConnection(); }
    function periodLabel(dimension) {
      const label = dimension.period?.label || '';
      if (lang() !== 'en') return label;
      if (label === '今天' || label.toLowerCase() === 'today') return t('today');
      return /[\u3400-\u9fff]/.test(label) ? dimension.period.days + 'D' : label;
    }
    function sampled(dimension) { return /已采集/.test(dimension.sourceLabel || '') || dimension.period?.label === '近 28 天内已采集日'; }
    function dimensionSource(dimension) {
      if (['followers', 'verifiedFollowers'].includes(dimension.key)) {
        const date = (dimension.sourceLabel || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] || dimension.at?.slice(0, 10) || '';
        return t('snapshot', { date });
      }
      if (sampled(dimension)) return t('sampledDays', { days: dimension.period?.days || 0 });
      if (dimension.period) return t('periodDays', { label: periodLabel(dimension), days: dimension.period.days });
      return t('unknown');
    }
    function renderDimensions(dimensions) {
      const list = $('.dimensions'); list.replaceChildren();
      for (const dimension of dimensions) {
        const row = document.createElement('div'); row.className = 'dimension';
        const heading = document.createElement('div'); heading.className = 'dimension-heading';
        const name = document.createElement('span'); name.textContent = t('lifetime_' + dimension.key);
        const score = document.createElement('b'); score.textContent = dimension.xp.toLocaleString('en-US') + ' EXP';
        heading.append(name, score);
        const detail = document.createElement('p');
        detail.textContent = t('actionCalculation', { count: dimension.count.toLocaleString('en-US'), rate: dimension.rate });
        row.append(heading, detail); list.append(row);
      }
    }
    function renderInventory(reveal = false) {
      const rewards = model?.rewards || { pending: 0, totalOwned: 0, totalItems: 12, items: [], nextLevel: 5 };
      const countText = t('collectionCount', { owned: rewards.totalOwned, total: rewards.totalItems });
      $('.collection-count').textContent = countText; $('.collection-total').textContent = rewards.totalOwned + ' / ' + rewards.totalItems;
      $('.chest-count').textContent = String(rewards.pending); $('.chest-count').hidden = !rewards.pending;
      $('.treasure-strip').classList.toggle('has-chest', rewards.pending > 0);
      $('.treasure-strip').title = rewards.pending ? t('chestReady') + ' · ' + t('pending', { count: rewards.pending }) : t('noChest');
      $('.inventory-caption').textContent = t(rewards.pending ? 'chestReady' : 'chestIdle');
      $('.open-chest').textContent = t(chestBusy ? 'opening' : 'openChest');
      $('.open-chest').disabled = chestBusy || !rewards.pending; $('.open-chest').setAttribute('aria-busy', String(chestBusy));
      $('.next-reward').textContent = rewards.nextLevel ? t('nextReward', { level: rewards.nextLevel }) : t('allLevels');
      $('.orb-loot').hidden = !rewards.pending; $('.orb-loot').textContent = String(rewards.pending);
      $('.orb-loot').title = t('pending', { count: rewards.pending });
      $('.orb').setAttribute('aria-label', t('expand') + (rewards.pending ? ' · ' + t('pending', { count: rewards.pending }) : ''));
      const items = rewards.items || [];
      const signature = JSON.stringify([lang(), selectedItem, items.map(item => [item.id, item.owned, item.count])]);
      if (signature !== inventorySignature) {
        const grid = $('.relic-grid'); grid.replaceChildren();
        for (const item of items) {
          const button = document.createElement('button'); button.type = 'button'; button.dataset.item = item.id;
          button.className = 'relic ' + item.rarity + (item.owned ? ' owned' : ' locked') + (item.id === selectedItem ? ' selected' : '');
          button.innerHTML = globalThis.XFocusRelicIcons.icon(item.kind);
          const label = item.owned ? item.name[lang()] : '???';
          button.title = label + ' · ' + t(item.owned ? item.rarity : 'locked');
          button.setAttribute('aria-label', button.title); button.setAttribute('aria-pressed', String(item.id === selectedItem));
          button.addEventListener('click', () => { selectedItem = item.id; $('.item-detail').classList.remove('revealed'); renderInventory(); });
          grid.append(button);
        }
        inventorySignature = signature;
      }
      const item = items.find(entry => entry.id === selectedItem);
      $('.item-detail').hidden = !item;
      if (item) {
        $('.item-detail').className = 'item-detail ' + item.rarity + (item.owned ? ' owned' : ' locked');
        $('.item-emblem').innerHTML = globalThis.XFocusRelicIcons.icon(item.kind);
        $('.item-rarity').textContent = t(item.owned ? item.rarity : 'locked');
        $('.item-name').textContent = item.owned ? item.name[lang()] : '???';
        $('.item-description').textContent = item.owned ? item.description[lang()] : t('itemHint');
        $('.item-count').textContent = item.owned ? t('copied', { count: item.count }) : t('noItems');
        if (reveal && item.owned) { void $('.item-detail').offsetWidth; $('.item-detail').classList.add('revealed'); }
      }
    }
    function feedback(previous, next) {
      if (!previous || previous.username !== next.username || previous.date !== next.date || previous.goals.posts !== next.goals.posts || previous.goals.replies !== next.goals.replies) return;
      const posts = next.posts - previous.posts, replies = next.replies - previous.replies, gain = next.totalXp - previous.totalXp;
      if (posts < 0 || replies < 0 || gain <= 0 || gain !== posts * 5 + replies) return;
      clearTimeout(rewardTimer); $('.card').classList.remove('level-up', 'quest-cleared'); $('.reward-float').classList.remove('show');
      for (const kind of ['posts', 'replies']) $('.quest[data-kind="' + kind + '"]').classList.remove('gained');
      void $('.card').offsetWidth;
      currentReward = next.level > previous.level ? { level: next.level } : { gain };
      $('.reward-float').textContent = currentReward.level ? t('levelUp', { level: currentReward.level }) : '+' + gain + ' EXP';
      $('.reward-float').hidden = false; $('.reward-float').classList.add('show');
      if (next.level > previous.level) $('.card').classList.add('level-up');
      if (!previous.complete && next.complete) $('.card').classList.add('quest-cleared');
      if (posts > 0) $('.quest[data-kind="posts"]').classList.add('gained');
      if (replies > 0) $('.quest[data-kind="replies"]').classList.add('gained');
      rewardTimer = setTimeout(() => {
        currentReward = null; $('.reward-float').hidden = true; $('.reward-float').classList.remove('show'); $('.card').classList.remove('level-up', 'quest-cleared');
        for (const kind of ['posts', 'replies']) $('.quest[data-kind="' + kind + '"]').classList.remove('gained');
      }, 2200);
    }
    function update(next) {
      if (destroyed) return;
      const previous = model; model = next; translateStatic();
      if (preferences().mode === 'mini') closePanels();
      $('.name').textContent = next.username || t('adventurer');
      $('.name').title = next.username ? '@' + next.username : t('identityHint');
      $('.verified-badge').hidden = next.blueVerified?.value !== true;
      $('.verified-badge').title = t('verified') + (next.blueVerified?.at ? ' · ' + t('readAt', { date: next.blueVerified.at.slice(0, 10) }) : '');
      $('.level').textContent = 'LV. ' + String(next.level).padStart(2, '0');
      const tier = next.level < 5 ? 0 : next.level < 15 ? 1 : next.level < 30 ? 2 : 3;
      $('.rank').textContent = t('rank' + tier); $('.rank-stars').textContent = '✧'.repeat(tier + 1); $('.rank').title = t('rankHint');
      $('.hud').style.setProperty('--aura', ['#94aecb', '#a9b99e', '#b4a1cd', '#dfc48b'][tier]);
      const assessment = next.assessment;
      $('.xp-num').textContent = next.xp + ' / 100 EXP';
      $('.xp-row').title = t('experienceHint', { total: next.totalXp.toLocaleString('en-US'), remaining: assessment.toNext });
      $('.xp-row .fill').style.width = assessment.progress + '%';
      $('.xp-row .track').setAttribute('aria-valuenow', String(assessment.progress)); $('.xp-row .track').setAttribute('aria-valuetext', $('.xp-row').title);
      $('.assessment-toggle').title = t('scoreDetail');
      $('.assessment-score').textContent = next.totalXp.toLocaleString('en-US') + ' EXP';
      $('.assessment-coverage').textContent = t('nextPoints', { points: assessment.toNext });
      $('.assessment-xp').textContent = t('lifetimeXp', { xp: compactNumber(next.totalXp) }); renderDimensions(assessment.dimensions);
      for (const kind of ['posts', 'replies']) {
        const quest = $('.quest[data-kind="' + kind + '"]'), goal = next.goals[kind], count = next[kind];
        quest.classList.toggle('done', goal > 0 && count >= goal);
        quest.querySelector('.count').innerHTML = '<strong>' + count + '</strong> / ' + (goal || '—');
        quest.querySelector('.fill').style.width = (goal ? Math.min(100, count / goal * 100) : 0) + '%';
        const track = quest.querySelector('.track'); track.setAttribute('aria-valuemax', String(goal || 1)); track.setAttribute('aria-valuenow', String(goal ? Math.min(count, goal) : 0));
        track.setAttribute('aria-valuetext', goal ? count + ' / ' + goal : t('noGoal'));
        quest.title = t('questHint', { count, auto: next.auto?.[kind] || 0 }) + (goal ? '' : ' · ' + t('disabledGoal'));
      }
      const active = ['posts', 'replies'].filter(kind => next.goals[kind] > 0);
      $('.quest-total').textContent = active.filter(kind => next[kind] >= next.goals[kind]).length + ' / ' + active.length; $('.completion').hidden = !next.complete;
      const followers = next.followers, views = next.views;
      $('.followers .metric-value').textContent = followers ? approximate(followers) + compactNumber(followers.value) : '—';
      $('.followers .metric-label').textContent = t(followers && followers.date !== next.date ? 'lastFollowers' : 'followers');
      $('.followers').title = followers ? t('followersHint', { date: followers.date, value: approximate(followers) + followers.value }) + (next.delta ? ' · ' + t('deltaHint', { date: next.delta.from, value: (next.delta.value >= 0 ? '+' : '') + next.delta.value }) : '') : t('profileHint');
      $('.delta').textContent = next.delta ? approximate(next.delta) + (next.delta.value >= 0 ? '+' : '') + compactNumber(next.delta.value) : '';
      $('.delta').classList.toggle('negative', next.delta?.value < 0);
      const verified = next.verifiedFollowers;
      $('.verified-followers .metric-value').textContent = verified ? approximate(verified) + compactNumber(verified.value) : '—';
      $('.verified-followers').title = verified ? t('verifiedFansHint', { date: verified.date, value: approximate(verified) + verified.value }) : t('verifiedFansEmpty');
      const exposure = next.analytics?.impressions, engagement = next.analytics?.engagements;
      for (const [selector, dimension, key] of [['.views', exposure, 'impressions'], ['.engagements', engagement, 'engagements']]) {
        const hasPeriod = dimension?.value != null && dimension.period, label = hasPeriod ? periodLabel(dimension) : '';
        const short = hasPeriod && !sampled(dimension) && label.length <= 4;
        $(selector + ' .metric-label').textContent = hasPeriod ? (short ? label + ' ' : '') + t(key) + (!short ? ' · ' + t('average') : '') : t(key);
        const value = hasPeriod ? (short ? dimension.totalValue : Math.round(dimension.value)) : null;
        $(selector + ' .metric-value').textContent = value != null ? approximate(dimension) + compactNumber(value) : '—';
        $(selector).title = hasPeriod ? t('periodHint', { period: dimensionSource(dimension), value: approximate(dimension) + Math.round(dimension.value).toLocaleString('en-US'), total: dimension.totalValue.toLocaleString('en-US') }) : t('analyticsEmpty', { metric: t(key) });
      }
      if (exposure?.value == null && views) {
        $('.views .metric-label').textContent = t(views.kind === 'tracked' ? 'tracked' : 'todayImpressions');
        $('.views .metric-value').textContent = approximate(views) + compactNumber(views.value); $('.views').title = t(views.kind === 'tracked' ? 'trackedHint' : 'todayImpressionsHint');
      }
      $('.date').textContent = next.date.slice(5).replace('-', ' / ');
      $('.tracking-toggle').textContent = t(next.enabled ? 'pause' : 'resume');
      $('.profile-link').href = 'https://x.com/' + (next.username || '');
      $('.orb-level').textContent = next.complete ? '✓' : String(next.level).padStart(2, '0'); $('.orb i').style.width = assessment.progress / 100 * 24 + 'px';
      renderConnection(); renderInventory(); feedback(previous, next); layout();
    }
    async function command(value, successKey) {
      currentError = null; $('.error').hidden = true;
      try {
        const next = await onCommand(value); if (next) update(next);
        if (successKey) { toastKey = successKey; $('.toast').textContent = t(successKey); $('.toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastKey = null; $('.toast').hidden = true; }, 2200); }
        return next;
      } catch (error) { currentError = error; $('.error').textContent = translatedError(error); $('.error').hidden = false; return null; }
    }
    const panelPairs = [['settings', 'settings-toggle'], ['assessment-panel', 'assessment-toggle'], ['connection-panel', 'connection-toggle'], ['inventory-panel', 'inventory-toggle']];
    function panel(name, open) {
      for (const [selector, button] of panelPairs) {
        if (selector === name || open) {
          const show = selector === name && open; $('.' + selector).hidden = !show; $('.' + button).setAttribute('aria-expanded', String(show));
        }
      }
      if (name === 'settings' && open && model) for (const kind of ['posts', 'replies']) $('input[name="' + kind + '"]').value = model.goals[kind];
      layout();
    }
    function closePanels() { for (const [name] of panelPairs) panel(name, false); }
    for (const [name, button] of panelPairs) $('.' + button).addEventListener('click', () => panel(name, $('.' + name).hidden));
    const toggleMode = () => savePreferences({ mode: preferences().mode === 'mini' ? 'full' : 'mini' });
    $('.minimize').addEventListener('click', toggleMode);
    $('.orb').addEventListener('click', () => savePreferences({ mode: 'full' }));
    $('.dock-left').addEventListener('click', () => { const position = positionAt(renderedLayout.left, renderedLayout.top); void savePreferences({ position: { ...position, anchor: 'left', x: 0 } }); });
    $('.dock-right').addEventListener('click', () => { const position = positionAt(renderedLayout.left, renderedLayout.top); void savePreferences({ position: { ...position, anchor: 'right', x: 1 } }); });
    $('.position-auto').addEventListener('click', () => savePreferences({ position: null }));
    const heading = $('.heading');
    const isControl = target => target?.closest?.('button,a,input,select,textarea');
    function startDrag(event) {
      if (!model || destroyed || drag || event.button !== 0 || event.isPrimary === false || isControl(event.target)) return;
      layout();
      drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, originLeft: renderedLayout.left, originTop: renderedLayout.top, left: renderedLayout.left, top: renderedLayout.top, moved: false };
      try { heading.setPointerCapture?.(event.pointerId); } catch {}
    }
    function moveDrag(event) {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true; drag.left = drag.originLeft + dx; drag.top = drag.originTop + dy;
      event.preventDefault(); $('.hud').classList.add('dragging'); layout();
    }
    function finishDrag(event, save) {
      if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.id)) return;
      const ended = drag, position = positionAt(renderedLayout.left, renderedLayout.top);
      drag = null; $('.hud').classList.remove('dragging');
      try { heading.releasePointerCapture?.(ended.id); } catch {}
      if (save && ended.moved) void savePreferences({ position });
      else layout();
    }
    const endDrag = event => { moveDrag(event); finishDrag(event, true); };
    const cancelDrag = event => finishDrag(event, false);
    heading.addEventListener('pointerdown', startDrag);
    heading.addEventListener('lostpointercapture', cancelDrag);
    window.addEventListener('pointermove', moveDrag, true);
    window.addEventListener('pointerup', endDrag, true);
    window.addEventListener('pointercancel', cancelDrag, true);
    window.addEventListener('blur', cancelDrag);
    heading.addEventListener('keydown', event => {
      if (isControl(event.target) || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const step = event.shiftKey ? 40 : 10;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      const position = positionAt(renderedLayout.left + dx, renderedLayout.top + dy, false);
      if (!dx && preferences().position?.anchor !== 'free') position.anchor = renderedLayout.anchor;
      void savePreferences({ position });
    });
    $('form').addEventListener('submit', async event => { event.preventDefault(); await command({ command: 'goals', posts: Number($('input[name="posts"]').value), replies: Number($('input[name="replies"]').value) }, 'saved'); });
    shadow.querySelectorAll('.correct button').forEach(button => button.addEventListener('click', () => { void command({ command: 'adjust', kind: button.dataset.kind, amount: Number(button.dataset.amount) }); }));
    $('.tracking-toggle').addEventListener('click', () => { if (model) void command({ command: 'tracking', enabled: !model.enabled }); });
    $('.language-select').addEventListener('change', async event => {
      if (languageBusy) return; languageBusy = true; $('.language-select').disabled = true;
      try { await command({ command: 'language', language: event.target.value }, 'languageSaved'); }
      finally { languageBusy = false; $('.language-select').disabled = false; $('.language-select').value = lang(); }
    });
    $('.scan-now').addEventListener('click', async () => {
      if (scanBusy || $('.scan-now').disabled || !model?.enabled || ['paused', 'account-mismatch'].includes(connection.status)) return;
      scanBusy = true; renderConnection();
      try { await command({ command: 'scan-now' }, 'scanned'); } finally { scanBusy = false; renderConnection(); }
    });
    $('.open-chest').addEventListener('click', async () => {
      if (chestBusy || !model?.rewards?.pending) return; chestBusy = true; renderInventory();
      try {
        const next = await command({ command: 'open-chest' });
        if (next?.rewards?.lastDrop) { selectedItem = next.rewards.lastDrop.id; renderInventory(true); }
      } finally { chestBusy = false; $('.open-chest').textContent = t('openChest'); $('.open-chest').disabled = !model?.rewards?.pending; $('.open-chest').setAttribute('aria-busy', 'false'); }
    });
    shadow.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (drag) { event.preventDefault(); finishDrag(null, false); return; }
      const current = panelPairs.find(([name]) => !$('.' + name).hidden);
      if (current) { panel(current[0], false); $('.' + current[1]).focus(); }
      else if (preferences().mode === 'full') { void savePreferences({ mode: 'mini' }); $('.minimize').focus(); }
    });
    let resizePending = false;
    function scheduleLayout() { if (resizePending) return; resizePending = true; requestAnimationFrame(() => { resizePending = false; layout(); }); }
    window.addEventListener('resize', scheduleLayout);
    const observer = new MutationObserver(scheduleLayout); observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    const interval = setInterval(layout, 2500);
    translateStatic(); renderConnection();
    return { update, layout, setConnection, toggle: toggleMode, destroy() { finishDrag(null, false); destroyed = true; observer.disconnect(); clearInterval(interval); clearTimeout(toastTimer); clearTimeout(rewardTimer); window.removeEventListener('resize', scheduleLayout); window.removeEventListener('pointermove', moveDrag, true); window.removeEventListener('pointerup', endDrag, true); window.removeEventListener('pointercancel', cancelDrag, true); window.removeEventListener('blur', cancelDrag); host.remove(); } };
  }
  globalThis.XFocusHUD = { mount, placement, resolveLayout };
})();
