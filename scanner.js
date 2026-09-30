(() => {
  function parseCount(raw) {
    if (typeof raw !== 'string') return null;
    const text = raw.replace(/[\u00a0\u202f]/g, ' ').trim();
    // Read only a number at the beginning, never a date or unrelated later number.
    const match = text.match(/^([\d,]+(?:\.\d+)?)\s*([KMB万亿千]?)(?=\s|$|次|位|名|个|粉丝|关注者|浏览)/i);
    if (!match) return null;
    const rawNumber = match[1];
    if (rawNumber.includes(',') && !/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(rawNumber)) return null;
    const unit = match[2].toUpperCase();
    if (!unit && rawNumber.includes('.')) return null;
    const value = Math.round(Number(rawNumber.replaceAll(',', '')) * ({ K: 1e3, M: 1e6, B: 1e9, 千: 1e3, 万: 1e4, 亿: 1e8 }[unit] || 1));
    return Number.isSafeInteger(value) && value >= 0 ? { value, approximate: !!unit } : null;
  }
  function loggedInUsername(doc) {
    const href = doc.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
    try { const path = xPath(href); const match = path?.match(/^\/([a-z0-9_]{1,15})\/?$/i); if (href && match) return match[1].toLowerCase(); } catch { /* Fall back only to the signed-in account switcher below. */ }
    const switchers = [...doc.querySelectorAll('[data-testid="SideNav_AccountSwitcher_Button"]')].filter(visible);
    if (switchers.length !== 1) return null;
    // Separate text leaves: textContent can concatenate "Soap" + "@soap628".
    const accountText = [switchers[0], ...switchers[0].querySelectorAll('*')].filter(node => !node.children.length).map(node => node.textContent).join(' ');
    const handles = [...new Set([...accountText.matchAll(/(?:^|[^a-z0-9_@])@([a-z0-9_]{1,15})(?![a-z0-9_])/gi)].map(match => match[1].toLowerCase()))];
    return handles.length === 1 ? handles[0] : null;
  }
  const normalize = text => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const metricLabels = {
    verifiedFollowers: /^(checkmarkfollowers|verifiedfollowers|(?:已)?认证(?:的)?(?:关注者|粉丝)|(?:已)?認證(?:的)?(?:關注者|粉絲)|蓝v粉丝|藍v粉絲)$/,
    impressions: /^(impressions|曝光量|曝光次数|展示次数|展示量)$/,
    engagements: /^(engagements|互动次数|互动数|互动量|参与次数|互動次數|互動數|互動量|參與次數)$/,
    profileVisits: /^(profilevisits|个人资料访问次数|个人资料访问量|主页访问量|主页访问次数)$/
  };
  const metricSelector = 'span,p,h2,h3,div,strong';
  const nonCardSelector = 'article,nav,aside,table,svg,canvas,[role="img"],[role="graphics-document"],[role="table"],[role="menu"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="listbox"],[role="option"],[role="combobox"],[role="tooltip"],select,option';
  const otherMetricLabel = /^(engagementrate|互动率|互動率|参与率|參與率|followers|关注者|粉丝|likes|点赞|喜欢|replies|回复|reposts|转帖|转发|bookmarks|书签|shares|分享|posts|帖子)$/;
  const metricLabelText = node => normalize(node.textContent).replace(/\s/g, '');
  const isMetricLabel = node => visible(node) && !node.closest(nonCardSelector) && [...Object.values(metricLabels), otherMetricLabel].some(re => re.test(metricLabelText(node)));
  function visible(node) {
    return !node.closest('[hidden],[aria-hidden="true"]') && (typeof node.getClientRects !== 'function' || node.getClientRects().length > 0);
  }
  function metricText(node) {
    if (!visible(node) || node.matches(nonCardSelector + ',script,style')) return '';
    // Preserve DOM text boundaries: a value followed by an SVG growth arrow
    // and percentage must not collapse from "93.4K 7K%" to "93.4K7K%".
    return [...node.childNodes].map(child => child.nodeType === 3 ? child.textContent : child.nodeType === 1 ? metricText(child) : '').filter(text => text.trim()).join(' ');
  }
  function chartValue(node) {
    return node.matches('canvas,[role="graphics-document"]') || (node.matches('[role="img"]:not(svg)') && node.textContent.trim())
      || [...node.querySelectorAll('canvas,svg text,[role="graphics-document"],[role="img"]:not(svg)')].some(child => visible(child) && (child.matches('canvas,svg text,[role="graphics-document"]') || child.textContent.trim()));
  }
  function cardLabel(node, expression) {
    if (!visible(node) || node.closest(nonCardSelector) || !expression.test(metricLabelText(node))) return false;
    const control = node.closest('button,[role="button"]');
    // Whole metric cards can be clickable. A label-only dropdown is different:
    // its following chart ticks must never become a card observation.
    const popup = control?.getAttribute('aria-haspopup');
    if (control && ((popup && popup !== 'false') || isMetricLabel(control))) return false;
    return ![...node.children].some(child => visible(child) && expression.test(metricLabelText(child)));
  }
  function metricCount(text) {
    // The card may show "2.2K / 3K" or "98K ↑7K%". The denominator and
    // comparison percentage are never observations of the metric itself.
    const number = '[\\d,]+(?:\\.\\d+)?\\s*[KMB万亿千]?';
    const match = String(text || '').replace(/[\u00a0\u202f]/g, ' ').replaceAll('／', '/').replaceAll('％', '%').trim().match(new RegExp(`^(${number})(?:\\s*\\/\\s*${number})?(?:(?:\\s*[↑↓+−-]\\s*|\\s+)${number}\\s*%)?\\s*$`, 'i'));
    return match ? parseCount(match[1]) : null;
  }
  function metricNodeValue(node) {
    if (node.closest(nonCardSelector) || chartValue(node)) return null;
    return metricCount(metricText(node));
  }
  function metricValue(doc, name) {
    const expression = metricLabels[name];
    const labels = [...doc.querySelectorAll(`main ${metricSelector.split(',').join(',main ')}`)]
      .filter(node => cardLabel(node, expression));
    const values = [];
    for (const label of labels) {
      let current = label;
      for (; current && !current.matches('main,body,section,article,button,[role="button"]'); current = current.parentElement) {
        let found = null, crossedMetric = false;
        for (let sibling = current.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
          if (!visible(sibling)) continue;
          if ([sibling, ...sibling.querySelectorAll(metricSelector)].some(isMetricLabel) || chartValue(sibling)) { crossedMetric = true; break; }
          found = metricNodeValue(sibling);
          if (found) break;
          // Only empty decoration may be skipped. A placeholder, rate or other
          // text closes this candidate; later numbers belong to another field.
          const excludedContent = [sibling, ...sibling.querySelectorAll(nonCardSelector)].some(node => visible(node) && node.matches(nonCardSelector) && !node.matches('svg,canvas'));
          if (metricText(sibling).trim() || excludedContent) { crossedMetric = true; break; }
        }
        if (found) { values.push(found); break; }
        if (crossedMetric || current.parentElement?.matches('main,body')) break;
      }
    }
    const unique = [...new Map(values.map(value => [value.value, value])).values()];
    return unique.length === 1 ? unique[0] : null;
  }
  function selectedPeriod(doc, now = new Date()) {
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(now);
    const periodText = node => (node.textContent || '').replace(/\s+/g, ' ').trim();
    function parsePeriod(text) {
      const compact = normalize(text);
      if (/^(today|今天|今日)$/.test(compact)) return { label: text, days: 1, start: today, end: today };
      const days = { '7d': 7, '2w': 14, '14d': 14, '4w': 28, '28d': 28 }[compact];
      if (days) return { label: text.toUpperCase(), days, start: null, end: null };
      const range = text.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?\s*(?:to|至|到|[–—-])\s*(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/i);
      if (!range) return null;
      const key = offset => `${range[offset]}-${range[offset + 1].padStart(2, '0')}-${range[offset + 2].padStart(2, '0')}`;
      const start = key(1), end = key(4), first = Date.parse(`${start}T00:00:00Z`), last = Date.parse(`${end}T00:00:00Z`);
      if (!Number.isFinite(first) || !Number.isFinite(last) || new Date(first).toISOString().slice(0, 10) !== start || new Date(last).toISOString().slice(0, 10) !== end || start > end || end > today) return null;
      const length = Math.round((last - first) / 86400000) + 1;
      return length <= 366 ? { label: text, days: length, start, end } : null;
    }
    const looksLikePeriod = text => /^(today|今天|今日|\d+[dwmy])$/i.test(text) || !!parsePeriod(text);
    const explicit = [...doc.querySelectorAll('main [aria-selected="true"],main [aria-pressed="true"],main [data-state="active"],main select option:checked')]
      .filter(node => visible(node) && looksLikePeriod(periodText(node)));
    if (explicit.length) {
      const periods = explicit.map(node => parsePeriod(periodText(node)));
      if (periods.some(period => !period)) return null;
      const unique = [...new Map(periods.map(period => [JSON.stringify(period), period])).values()];
      return unique.length === 1 ? unique[0] : null;
    }
    // X also renders the period as a row of plain pills. Only accept one
    // unambiguously bright pill amongst dark sibling pills; never guess by order.
    const getStyle = doc.defaultView?.getComputedStyle;
    if (typeof getStyle !== 'function') return null;
    const buttons = [...doc.querySelectorAll('main button,main [role="button"]')].filter(node => visible(node) && /^(\d+[dwmy]|today|今天|今日)$/i.test(periodText(node)));
    if (buttons.length < 2) return null;
    function brightness(node) {
      let color;
      try { color = getStyle.call(doc.defaultView, node).backgroundColor; } catch { return null; }
      const parts = color?.match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
      if (!parts) return color === 'transparent' ? 0 : null;
      const alpha = parts[4] === undefined ? 1 : Number(parts[4]);
      return (Number(parts[1]) * .2126 + Number(parts[2]) * .7152 + Number(parts[3]) * .0722) / 255 * alpha;
    }
    const colors = buttons.map(brightness), bright = colors.map((value, index) => value !== null && value > .65 ? index : -1).filter(index => index >= 0);
    if (bright.length !== 1 || colors.some((value, index) => index !== bright[0] && (value === null || value > .3))) return null;
    const active = buttons[bright[0]];
    if (!buttons.every(node => node.parentElement === active.parentElement || node.parentElement?.parentElement === active.parentElement?.parentElement)) return null;
    return parsePeriod(periodText(active));
  }
  const analyticsObservations = new WeakMap();
  const analyticsMetricNames = ['impressions', 'engagements', 'profileVisits'];
  function analyticsReady(doc, username, pathname, now) {
    if (!/^\/i\/account_analytics(?:\/|$)/.test(pathname) || loggedInUsername(doc) !== username.toLowerCase()) return false;
    const period = selectedPeriod(doc, now);
    const periodKey = JSON.stringify(period);
    const values = Object.fromEntries(analyticsMetricNames.map(name => [name, metricValue(doc, name)]));
    const valuesKey = JSON.stringify(values);
    const loading = [...doc.querySelectorAll('main[aria-busy="true"],main [aria-busy="true"],main [role="progressbar"],main [data-testid="spinner"]')].some(node => {
      if (!visible(node)) return false;
      if (node.matches('[aria-busy="true"],[data-testid="spinner"]')) return true;
      const loadingText = [node.getAttribute('aria-label'), node.getAttribute('aria-valuetext'), node.getAttribute('title'), node.textContent].filter(Boolean).join(' ');
      if (/\b(?:loading|fetching|refreshing)\b|加载|載入|載入中|正在获取|正在刷新/i.test(loadingText)) return true;
      // A numeric progressbar without loading semantics can be a permanent
      // follower-goal gauge; an indeterminate bar still means loading.
      const value = node.getAttribute('aria-valuenow');
      return value === null || value.trim() === '' || !Number.isFinite(Number(value));
    });
    const timestamp = now.getTime();
    let previous = analyticsObservations.get(doc);
    if (!previous || previous.username !== username) {
      const baseline = period ? Object.fromEntries(analyticsMetricNames.filter(name => values[name]).map(name => [name, values[name].value])) : {};
      previous = { username, periodKey, valuesKey, lastValues: { ...baseline }, blocked: new Map(),
        acceptedByPeriod: new Map(!loading && period ? [[periodKey, baseline]] : []),
        pending: loading, busy: loading, sawLoading: loading, stableSince: timestamp };
      analyticsObservations.set(doc, previous);
      return !loading;
    }
    if (periodKey !== previous.periodKey) {
      previous.periodKey = periodKey;
      previous.pending = true;
      previous.sawLoading = false;
      previous.stableSince = timestamp;
      if (period) {
        const accepted = previous.acceptedByPeriod.get(periodKey) || {};
        previous.blocked = new Map(analyticsMetricNames
          .filter(name => previous.lastValues[name] !== undefined && !(values[name] && Object.hasOwn(accepted, name) && accepted[name] === values[name].value))
          .map(name => [name, previous.lastValues[name]]));
      }
    }
    if (valuesKey !== previous.valuesKey) { previous.valuesKey = valuesKey; previous.stableSince = timestamp; }
    // Null placeholders do not erase the last displayed value, nor prove that
    // an unchanged value appearing afterward belongs to the new range.
    if (period) for (const name of analyticsMetricNames) if (values[name]) previous.lastValues[name] = values[name].value;
    if (loading) {
      previous.pending = true;
      previous.busy = true;
      previous.sawLoading = true;
      previous.stableSince = timestamp;
      return false;
    }
    if (previous.busy) { previous.busy = false; previous.stableSince = timestamp; }
    if (previous.pending && timestamp - previous.stableSince < 1500) return false;
    // Confirm each metric independently. A changed impression count cannot
    // authorize an unchanged engagement count from the previous range.
    if (previous.sawLoading) previous.blocked.clear();
    else for (const [name, baseline] of previous.blocked) {
      if (values[name] && values[name].value !== baseline) previous.blocked.delete(name);
    }
    previous.pending = previous.blocked.size > 0;
    previous.sawLoading = false;
    if (period) {
      const accepted = previous.acceptedByPeriod.get(periodKey) || {};
      for (const name of analyticsMetricNames) if (values[name] && !previous.blocked.has(name)) accepted[name] = values[name].value;
      previous.acceptedByPeriod.set(periodKey, accepted);
      if (previous.acceptedByPeriod.size > 16) previous.acceptedByPeriod.delete(previous.acceptedByPeriod.keys().next().value);
    }
    return true;
  }
  function analyticsMetricReady(doc, name) { return !analyticsObservations.get(doc)?.blocked.has(name); }
  function scanAccountMetrics(doc, username, pathname, now = new Date()) {
    const result = {};
    if (!/^\/i\/account_analytics(?:\/|$)/.test(pathname) || loggedInUsername(doc) !== username.toLowerCase()) return result;
    const verified = metricValue(doc, 'verifiedFollowers');
    if (verified) result.verifiedFollowers = verified;
    if (!analyticsReady(doc, username, pathname, now)) return result;
    const period = selectedPeriod(doc, now);
    if (!period) return result;
    const analyticsSummary = { period };
    for (const name of analyticsMetricNames) {
      if (!analyticsMetricReady(doc, name)) continue;
      const value = metricValue(doc, name);
      if (value) analyticsSummary[name] = value;
    }
    if (Object.keys(analyticsSummary).length > 1) result.analyticsSummary = analyticsSummary;
    return result;
  }
  function scanAnalytics(doc, username, pathname, now = new Date()) {
    if (!/^\/i\/account_analytics(?:\/|$)/.test(pathname) || loggedInUsername(doc) !== username.toLowerCase()) return [];
    if (!analyticsReady(doc, username, pathname, now)) return [];
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(now);
    const records = [];
    const normalize = text => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const label = text => /^(impressions|曝光量|曝光次数|展示次数|展示量)$/.test(normalize(text));
    const visible = node => !node.closest('[hidden],[aria-hidden="true"]') && (typeof node.getClientRects !== 'function' || node.getClientRects().length > 0);
    for (const table of doc.querySelectorAll('table,[role="table"]')) {
      const rows = [...table.querySelectorAll('tr,[role="row"]')];
      const headers = [...(rows[0]?.querySelectorAll('th,td,[role="columnheader"],[role="cell"]') || [])].map(c => normalize(c.textContent));
      const dateIndex = headers.findIndex(h => /^(date|日期)$/.test(h)), valueIndex = headers.findIndex(label);
      if (dateIndex < 0 || valueIndex < 0 || !visible(table)) continue;
      for (const row of rows.slice(1)) {
        const cells = [...row.querySelectorAll('td,[role="cell"]')];
        const dateText = cells[dateIndex]?.textContent.trim();
        const date = dateText?.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/);
        if (!date) continue;
        const key = `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`;
        const value = parseCount(cells[valueIndex]?.textContent || '');
        if (value && key <= today) records.push({ date: key, ...value });
      }
    }
    if (records.length) return records.slice(0, 31);
    if (!analyticsMetricReady(doc, 'impressions')) return [];
    const selected = [...doc.querySelectorAll('[aria-selected="true"],[aria-pressed="true"],[data-state="active"],select option:checked')].filter(visible);
    if (!selected.some(node => /^(today|今天|今日)$/.test(normalize(node.textContent)))) return [];
    const value = metricValue(doc, 'impressions');
    return value ? [{ date: today, ...value }] : [];
  }
  const embeddedPostSelector = '[data-testid="quoteTweet"],[data-testid="card.wrapper"],[role="link"]:not(a)';
  function xPath(href) {
    try {
      const url = new URL(href, 'https://x.com');
      return /^https?:$/.test(url.protocol) && /^(?:www\.)?(?:x|twitter)\.com$/.test(url.hostname) ? url.pathname.toLowerCase() : null;
    } catch { return null; }
  }
  function outerNode(node, article) {
    return !!node && node.closest('article[data-testid="tweet"]') === article && !node.closest(embeddedPostSelector);
  }
  function postKind(article) {
    // DOM classification is deliberately narrower than the response parser.
    // A reply can omit its context on Home/detail/thread views, so the absence
    // of a "Replying to" label must never mean "original post" there.
    const text = article.querySelector('[data-testid="tweetText"]');
    const contexts = [...article.querySelectorAll('div,span')].filter(node => outerNode(node, article) && visible(node)
      && !node.closest('[data-testid="tweetText"],[data-testid="User-Name"],[data-testid="socialContext"]')
      && !(text && node.contains(text)) && !node.querySelector('[data-testid="User-Name"]'));
    const profileLinks = node => [...node.querySelectorAll('a[href]')].filter(link => /^\/[a-z0-9_]{1,15}\/?$/i.test(xPath(link.getAttribute('href')) || '') && /^@/.test(link.textContent.trim()));
    const social = [...article.querySelectorAll('[data-testid="socialContext"]')].filter(visible);
    // Only a known pin label is harmless; translated or unknown social context
    // is not reliable enough to award an action.
    if (social.some(node => !/^(pinned|置顶|已置顶|已置頂|置頂)$/i.test(node.textContent.trim()))) return undefined;
    if (article.querySelector('[data-testid="quoteTweet"]')
      || [...article.querySelectorAll('[data-testid="card.wrapper"],[role="link"]:not(a)')].some(node => node.querySelector('time,a[href*="/status/"]'))) return undefined;
    if (contexts.some(node => /^(?:replying to\b|回复(?:给|至)?\s*|回覆(?:給|至)?\s*)/i.test(node.textContent.trim()) && profileLinks(node).length)) return 'replies';
    // Even the profile's Posts tab can contain a self-reply in a standalone
    // cell with no visible context. Its type needs a network/publish proof.
    return undefined;
  }
  function scan(doc, username, pathname, now = new Date()) {
    const result = { username, followers: null, posts: [], analytics: scanAnalytics(doc, username, pathname, now), ...scanAccountMetrics(doc, username, pathname, now) };
    if (!/^[a-z0-9_]{1,15}$/i.test(username)) return result;
    const owner = username.toLowerCase();
    const profileRoute = pathname.toLowerCase().match(/^\/([a-z0-9_]+)(?:\/(with_replies|media|highlights|articles))?\/?$/);
    if (profileRoute?.[1] === owner) {
      const links = doc.querySelectorAll('main a[href]');
      for (const a of links) {
        if (a.closest('article')) continue;
        const path = new URL(a.getAttribute('href'), 'https://x.com').pathname.toLowerCase();
        if (![ `/${owner}/verified_followers`, `/${owner}/followers` ].includes(path)) continue;
        if (/verified followers|认证关注者|认证粉丝/i.test(a.textContent)) continue;
        const precise = a.getAttribute('title') || a.querySelector('[title]')?.getAttribute('title');
        const value = (precise && parseCount(precise)) || parseCount(a.textContent);
        if (value && (!result.followers || !value.approximate)) result.followers = value;
      }
    }
    for (const article of doc.querySelectorAll('article[data-testid="tweet"]')) {
      if (!visible(article)) continue;
      // First timestamp is the outer post, so a quoted post cannot change its owner.
      const time = article.querySelector('time[datetime]');
      if (!outerNode(time, article)) continue;
      const status = time?.closest('a[href]');
      const match = xPath(status?.getAttribute('href'))?.match(/^\/([a-z0-9_]{1,15})\/status\/(\d{1,30})\/?$/i);
      if (!match || match[1].toLowerCase() !== owner) continue;
      const viewLink = [...article.querySelectorAll('a[href]')].find(a => outerNode(a, article) && xPath(a.getAttribute('href')) === `/${owner}/status/${match[2]}/analytics`);
      const count = viewLink && (parseCount(viewLink.getAttribute('aria-label') || '') || parseCount(viewLink.textContent));
      const kind = postKind(article);
      const edited = [...article.querySelectorAll('a[href],span')].some(node => outerNode(node, article) && !node.closest('[data-testid="tweetText"]')
        && (/\/status\/\d+\/history\/?$/.test(xPath(node.getAttribute('href')) || '') || /^(edited|last edited|已编辑|已編輯)$/i.test(node.textContent.trim())));
      result.posts.push({ id: match[2], views: count ? count.value : null, approximate: count ? count.approximate : false, createdAt: time.getAttribute('datetime'), text: article.querySelector('[data-testid="tweetText"]')?.textContent || '图片、视频或无文字帖子', ...(kind ? { kind } : {}), ...(edited ? { edited: true } : {}) });
    }
    return result;
  }
  function analyticsPending(doc) { return analyticsObservations.get(doc)?.pending === true; }
  globalThis.XFocusScanner = { parseCount, scan, scanAnalytics, scanAccountMetrics, loggedInUsername, analyticsPending };
})();
