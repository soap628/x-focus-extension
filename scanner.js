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
    verifiedFollowers: /^(checkmark followers|verified followers|认证关注者|认证粉丝|蓝v粉丝|蓝 v 粉丝)$/,
    impressions: /^(impressions|曝光量|曝光次数|展示次数|展示量)$/,
    engagements: /^(engagements|互动次数|互动量|参与次数)$/,
    profileVisits: /^(profile visits|个人资料访问次数|个人资料访问量|主页访问量|主页访问次数)$/
  };
  const metricSelector = 'span,p,h2,h3,div,strong';
  function visible(node) {
    return !node.closest('[hidden],[aria-hidden="true"]') && (typeof node.getClientRects !== 'function' || node.getClientRects().length > 0);
  }
  function metricCount(text) {
    // The card may show "2.2K / 3K" or "98K ↑7K%". The denominator and
    // comparison percentage are never observations of the metric itself.
    const number = '[\\d,]+(?:\\.\\d+)?\\s*[KMB万亿千]?';
    const match = String(text || '').replace(/[\u00a0\u202f]/g, ' ').trim().match(new RegExp(`^(${number})(?:\\s*\\/\\s*${number})?(?:\\s*[↑↓+−-]\\s*${number}\\s*%)?\\s*$`, 'i'));
    return match ? parseCount(match[1]) : null;
  }
  function metricNodeValue(node) {
    if (node.matches('svg,canvas,button,[role="button"]') || node.querySelector('canvas,svg text')) return null;
    const full = metricCount(node.textContent);
    if (full) return full;
    // X sometimes renders the growth arrow as an SVG, so textContent is
    // "98K7K%". Use the separate leading value element, never the percentage.
    const children = [...node.children].filter(visible);
    const first = children[0] && metricCount(children[0].textContent);
    const tail = children.slice(1).map(child => child.textContent.trim()).join(' ').trim();
    return first && /^(?:[↑↓+−-]\s*)?[\d,.]+\s*[KMB万亿千]?\s*%$/i.test(tail) ? first : null;
  }
  function metricValue(doc, name) {
    const expression = metricLabels[name];
    const labels = [...doc.querySelectorAll(`main ${metricSelector.split(',').join(',main ')}`)]
      .filter(node => visible(node) && expression.test(normalize(node.textContent)) && ![...node.children].some(child => expression.test(normalize(child.textContent))));
    const values = [];
    for (const label of labels) {
      let current = label;
      for (let depth = 0; current && depth < 3; depth++, current = current.parentElement) {
        let found = null, crossedMetric = false;
        for (let sibling = current.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
          if (!visible(sibling)) continue;
          if ([sibling, ...sibling.querySelectorAll(metricSelector)].some(node => Object.values(metricLabels).some(re => re.test(normalize(node.textContent))))) { crossedMetric = true; break; }
          found = metricNodeValue(sibling);
          if (found) break;
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
  function analyticsReady(doc, username, pathname, now) {
    if (!/^\/i\/account_analytics(?:\/|$)/.test(pathname) || loggedInUsername(doc) !== username.toLowerCase()) return false;
    const periodKey = JSON.stringify(selectedPeriod(doc, now));
    const valuesKey = JSON.stringify(['impressions', 'engagements', 'profileVisits'].map(name => metricValue(doc, name)));
    const loading = [...doc.querySelectorAll('main[aria-busy="true"],main [aria-busy="true"],main [role="progressbar"],main [data-testid="spinner"]')].some(visible);
    const timestamp = now.getTime();
    let previous = analyticsObservations.get(doc);
    if (!previous || previous.username !== username) {
      previous = { username, periodKey, valuesKey, acceptedValues: loading ? null : valuesKey, pending: loading, busy: loading, sawLoading: loading, periodChanged: false, stableSince: timestamp };
      analyticsObservations.set(doc, previous);
      return !loading;
    }
    if (periodKey !== previous.periodKey) {
      previous.periodKey = periodKey;
      previous.pending = true;
      previous.periodChanged = true;
      previous.stableSince = timestamp;
    }
    if (valuesKey !== previous.valuesKey) { previous.valuesKey = valuesKey; previous.stableSince = timestamp; }
    if (loading) {
      previous.pending = true;
      previous.busy = true;
      previous.sawLoading = true;
      previous.stableSince = timestamp;
      return false;
    }
    if (previous.busy) { previous.busy = false; previous.stableSince = timestamp; }
    // During a range switch, the pill can change before its cards. Without a
    // loading signal, unchanged old totals are insufficient proof of readiness.
    if (previous.pending && previous.periodChanged && !previous.sawLoading && valuesKey === previous.acceptedValues) return false;
    if (previous.pending && timestamp - previous.stableSince < 1500) return false;
    previous.pending = false;
    previous.sawLoading = false;
    previous.periodChanged = false;
    previous.acceptedValues = valuesKey;
    return true;
  }
  function scanAccountMetrics(doc, username, pathname, now = new Date()) {
    const result = {};
    if (!/^\/i\/account_analytics(?:\/|$)/.test(pathname) || loggedInUsername(doc) !== username.toLowerCase()) return result;
    const verified = metricValue(doc, 'verifiedFollowers');
    if (verified) result.verifiedFollowers = verified;
    if (!analyticsReady(doc, username, pathname, now)) return result;
    const period = selectedPeriod(doc, now);
    if (!period) return result;
    const analyticsSummary = { period };
    for (const name of ['impressions', 'engagements', 'profileVisits']) {
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
    const selected = [...doc.querySelectorAll('[aria-selected="true"],[aria-pressed="true"],[data-state="active"],select option:checked')].filter(visible);
    if (!selected.some(node => /^(today|今天|今日)$/.test(normalize(node.textContent)))) return [];
    const labels = [...doc.querySelectorAll('main span,main p,main h2,main h3')].filter(node => visible(node) && label(node.textContent));
    const values = [];
    for (const node of labels) {
      let parent = node.parentElement;
      for (let depth = 0; parent && depth < 3; depth++, parent = parent.parentElement) {
        const leaves = [...parent.querySelectorAll('span,p,h2,h3,strong')].filter(n => visible(n) && !n.querySelector('span,p,h2,h3,strong'));
        const candidates = leaves.map(n => n.textContent.trim()).filter(text => /^[\d,]+(?:\.\d+)?\s*[KMB万亿千]?$/i.test(text)).map(parseCount).filter(Boolean);
        if (candidates.length === 1) { values.push(candidates[0]); break; }
        if (candidates.length > 1) break;
      }
    }
    const unique = [...new Map(values.map(v => [v.value, v])).values()];
    return unique.length === 1 ? [{ date: today, ...unique[0] }] : [];
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
