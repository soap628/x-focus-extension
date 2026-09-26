(() => {
  let config = { username: '', enabled: true }, configLoaded = false;
  let pending = false, lastSignature = '', lastRun = 0, stopped = false, lastHeartbeat = 0;
  let detectedUsername = null, observerReady = false, observerTimedOut = false, handshakeTimer = null, transportError = '';
  let publishedConfig = '';
  let collection = null, analyticsRetryTimer = null, analyticsRetries = 0;
  const ANALYTICS_RETRY_MS = 2000, ANALYTICS_RETRY_LIMIT = 3;
  const inFlight = new Set();
  let hud = null, summary = null;
  function connection() {
    const params = { active: detectedUsername || '', bound: config.username || '' };
    if (stopped) return { status: 'error', code: 'stopped', params, message: '扩展已更新，请刷新 X 页面' };
    if (transportError) return { status: 'error', code: 'transport', params, message: transportError };
    if (!configLoaded) return { status: 'connecting', code: 'config', params, message: '正在连接本机记录' };
    if (!config.enabled) return { status: 'paused', code: 'paused', params, message: '自动记录已暂停' };
    if (detectedUsername && config.username && detectedUsername !== config.username) return { status: 'account-mismatch', code: 'mismatch', params, message: `当前为 @${detectedUsername}，请切回 @${config.username}` };
    if (!detectedUsername || !config.username) return { status: 'waiting-account', code: 'identity', params, message: '等待识别登录账号，请在 X 完成登录' };
    if (!observerReady) return observerTimedOut
      ? { status: 'error', code: 'handshake-timeout', params, message: '自动记录未连接，请刷新 X 页面' }
      : { status: 'connecting', code: 'handshake', params, message: '正在连接页面自动记录' };
    return { status: 'ready', code: 'ready', params, message: '自动记录已连接，等待本页活动' };
  }
  function showConnection() { hud?.setConnection?.(connection()); }
  function showSummary(next) { if (next) { summary = next; hud?.update(next); } showConnection(); }
  function mountHUD() {
    if (hud || !globalThis.XFocusHUD) return;
    hud = XFocusHUD.mount({ onCommand: async action => {
      if (action.command === 'scan-now') {
        clearAnalyticsRetry();
        const result = await collect(true);
        if (result.error) throw Object.assign(new Error(result.error), { code: result.code });
        scheduleAnalyticsRetry();
        const response = await send({ type: 'hud' });
        configure(response.config);
        return response.hud;
      }
      const response = await send({ type: 'hud-command', ...action });
      configure(response.config);
      return response.hud;
    } });
    if (summary) hud?.update(summary);
    showConnection();
  }
  function readIdentity() {
    const next = globalThis.XFocusScanner?.loggedInUsername(document) || null;
    if (next === detectedUsername) return false;
    detectedUsername = next;
    lastSignature = '';
    clearAnalyticsRetry();
    return true;
  }
  function observerConfig() {
    // A second signed-in account must never write into the bound account's log.
    return { username: config.username, enabled: !stopped && configLoaded && config.enabled && detectedUsername === config.username && !!config.username, startedAt: config.startedAt };
  }
  function publishConfig(force = false) {
    const next = JSON.stringify(observerConfig());
    if (next !== publishedConfig) {
      publishedConfig = next;
      observerReady = false;
      observerTimedOut = false;
      if (handshakeTimer !== null) clearTimeout(handshakeTimer);
      handshakeTimer = setTimeout(() => { if (!observerReady) { observerTimedOut = true; showConnection(); } }, 8000);
    } else if (!force) { showConnection(); return; }
    window.dispatchEvent(new CustomEvent('x-focus-config-v2', { detail: next }));
    showConnection();
  }
  function configure(next) {
    if (!next) return;
    if (next.username !== config.username || next.enabled !== config.enabled) { lastSignature = ''; clearAnalyticsRetry(); }
    config = next;
    configLoaded = true;
    readIdentity();
    publishConfig(true);
  }
  async function send(message) {
    let response;
    try {
      response = await chrome.runtime.sendMessage(message);
      if (!response) throw new Error('本机记录服务未响应');
      transportError = '';
    } catch (error) {
      if (!chrome.runtime?.id || /extension context invalidated/i.test(error.message || '')) stopped = true;
      transportError = '无法连接本机记录，请刷新 X 页面';
      if (stopped) publishConfig();
      showConnection();
      error.code = stopped ? 'stopped' : 'transport';
      throw error;
    }
    if (!response.ok) throw Object.assign(new Error(response.error || '保存失败'), { code: 'config' });
    showSummary(response.hud);
    return response;
  }
  window.addEventListener('x-focus-data-v2', async event => {
    if (stopped || typeof event.detail !== 'string' || event.detail.length > 300000) return;
    let packet;
    try { packet = JSON.parse(event.detail); } catch { return; }
    if (!packet || typeof packet !== 'object') return;
    if (packet.hello) { readIdentity(); publishConfig(true); return; }
    if (packet.ready) {
      const expected = observerConfig();
      if (packet.username === expected.username && packet.enabled === expected.enabled) {
        observerReady = true;
        observerTimedOut = false;
        if (handshakeTimer !== null) clearTimeout(handshakeTimer);
        showConnection();
      }
      return;
    }
    if (readIdentity()) publishConfig();
    if (!observerConfig().enabled || packet.username !== config.username || !Array.isArray(packet.posts) || typeof packet.packetId !== 'string' || inFlight.has(packet.packetId)) return;
    inFlight.add(packet.packetId);
    try {
      await send({ type: 'network', username: config.username, posts: packet.posts.slice(0, 200), followers: packet.followers,
        ...(packet.verifiedFollowers ? { verifiedFollowers: packet.verifiedFollowers } : {}),
        ...(packet.analyticsSummary ? { analyticsSummary: packet.analyticsSummary } : {}),
        ...(typeof packet.blueVerified === 'boolean' ? { blueVerified: packet.blueVerified } : {}) });
      window.dispatchEvent(new CustomEvent('x-focus-config-v2', { detail: JSON.stringify({ ack: packet.packetId }) }));
    } catch { /* queued sanitized packets retry at the next handshake */ }
    finally { inFlight.delete(packet.packetId); }
  });
  function clearAnalyticsRetry() {
    if (analyticsRetryTimer !== null) clearTimeout(analyticsRetryTimer);
    analyticsRetryTimer = null;
    analyticsRetries = 0;
  }
  function scheduleAnalyticsRetry() {
    if (stopped || !config.enabled || document.visibilityState !== 'visible' || detectedUsername !== config.username || !XFocusScanner.analyticsPending?.(document)) { clearAnalyticsRetry(); return; }
    if (analyticsRetryTimer !== null || analyticsRetries >= ANALYTICS_RETRY_LIMIT) return;
    analyticsRetryTimer = setTimeout(() => {
      analyticsRetryTimer = null;
      analyticsRetries++;
      lastRun = Date.now();
      void collect();
    }, ANALYTICS_RETRY_MS);
  }
  function collect(force = false) {
    if (collection) return collection;
    collection = runCollection(force).finally(() => { collection = null; });
    return collection;
  }
  async function runCollection(force = false) {
    if (stopped) return { count: 0, analytics: 0 };
    if (readIdentity()) publishConfig();
    showConnection();
    if (!configLoaded || !config.enabled || (!force && document.visibilityState !== 'visible')) return { count: 0, analytics: 0 };
    try {
      if (!config.username && detectedUsername) configure((await send({ type: 'bind', username: detectedUsername })).config);
      if (!config.username || detectedUsername !== config.username) return { count: 0, analytics: 0 };
      if (Date.now() - lastHeartbeat > 60000) { await send({ type: 'heartbeat', username: config.username }); lastHeartbeat = Date.now(); }
      // A pause/account switch can occur while storage is answering the heartbeat.
      if (readIdentity()) publishConfig();
      if (!observerConfig().enabled) return { count: 0, analytics: 0 };
      const payload = XFocusScanner.scan(document, config.username, location.pathname);
      scheduleAnalyticsRetry();
      const signature = JSON.stringify(payload) + new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
      const result = { count: payload.posts.length, followers: !!payload.followers, analytics: payload.analytics.length };
      if (!force && signature === lastSignature) return result;
      if (payload.followers || payload.verifiedFollowers || payload.analyticsSummary || typeof payload.blueVerified === 'boolean' || payload.posts.length || payload.analytics.length) { await send({ type: 'capture', ...payload }); lastSignature = signature; }
      return result;
    } catch (error) { return { error: error.message, code: error.code || (stopped ? 'stopped' : 'config') }; }
  }
  function schedule(renewRetries = false) {
    if (stopped) return;
    if (readIdentity()) publishConfig();
    if (renewRetries) clearAnalyticsRetry();
    if (document.visibilityState !== 'visible') return;
    if (pending) return;
    pending = true;
    const interval = /^\/i\/account_analytics(?:\/|$)/.test(location.pathname) ? 1500 : 3500;
    setTimeout(() => { pending = false; lastRun = Date.now(); void collect(); }, Math.max(350, interval - (Date.now() - lastRun)));
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === 'hud-toggle') { mountHUD(); hud?.toggle(); respond({ ok: true }); return; }
    if (message.type === 'config') { configure(message.config); showSummary(message.hud); schedule(); respond({ ok: true }); return; }
    if (message.type !== 'scan') return;
    collect(true).then(respond); return true;
  });
  new MutationObserver(() => schedule(true)).observe(document, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['aria-selected', 'aria-pressed', 'aria-busy', 'data-state', 'class', 'style'] });
  document.addEventListener('visibilitychange', () => {
    readIdentity(); publishConfig(true); schedule(true);
    if (!stopped && document.visibilityState === 'visible') void send({ type: 'hud' }).then(response => configure(response.config)).catch(() => {});
  });
  document.addEventListener('DOMContentLoaded', () => { mountHUD(); schedule(); }, { once: true });
  if (document.readyState !== 'loading') mountHUD();
  send({ type: 'config' }).then(response => { configure(response.config); schedule(); }).catch(() => {});
  setInterval(() => {
    if (stopped) { showConnection(); return; }
    readIdentity(); publishConfig(true); schedule(true);
    void send({ type: 'hud' }).then(response => configure(response.config)).catch(() => {});
  }, 60000);
})();
