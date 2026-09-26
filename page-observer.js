(() => {
  if (window.__xFocusObserverV2) return;
  Object.defineProperty(window, '__xFocusObserverV2', { value: true });
  let username = '', enabled = false, bufferUntilIdentity = true, cancellationEpoch = 0;
  const outbox = [], retryDelays = [2000, 5000, 10000];
  const eventName = 'x-focus-data-v2', maxBodySize = 8 * 1024 * 1024, queueLifetime = 5 * 60 * 1000;
  let retryTimer = null, retryAttempt = 0;
  function emit(detail) { window.dispatchEvent(new CustomEvent(eventName, { detail: JSON.stringify(detail) })); }
  function clearRetry() {
    if (retryTimer !== null && typeof clearTimeout === 'function') clearTimeout(retryTimer);
    retryTimer = null;
  }
  function prune() {
    const oldest = Date.now() - queueLifetime;
    for (let i = outbox.length - 1; i >= 0; i--) {
      if (Date.parse(outbox[i].capturedAt) < oldest || (username && outbox[i].username !== username)) outbox.splice(i, 1);
    }
    if (!outbox.length) clearRetry();
  }
  function replay() {
    prune();
    if (!enabled || !username) return;
    // An acknowledgement may arrive synchronously while dispatching this event.
    for (const packet of [...outbox]) if (packet.username === username) emit(packet);
    scheduleRetry();
  }
  function scheduleRetry() {
    if (!enabled || !username || !outbox.length || retryTimer !== null || retryAttempt >= retryDelays.length || typeof setTimeout !== 'function') return;
    retryTimer = setTimeout(() => { retryTimer = null; replay(); }, retryDelays[retryAttempt++]);
  }
  function captureContext(op) {
    if (enabled && username) return { username, epoch: cancellationEpoch };
    // Before identity is available, retain only confirmed publish results. Never
    // collect a timeline or a raw response while waiting for account detection.
    if (bufferUntilIdentity && /^Create(?:Note)?Tweet/.test(op || '')) return { username: null, epoch: cancellationEpoch };
    return null;
  }
  function handle(payload, op, context) {
    if (!context || context.epoch !== cancellationEpoch || (!enabled && !bufferUntilIdentity)) return;
    const result = context.username ? XFocusNetwork.parse(payload, op, context.username) : XFocusNetwork.parsePublished?.(payload, op);
    if (!result || (username && result.username !== username) || (!result.followers && typeof result.blueVerified !== 'boolean' && !result.posts.length)) return;
    const packet = { ...result, operation: op, capturedAt: new Date().toISOString(), packetId: crypto.randomUUID() };
    prune();
    outbox.push(packet);
    if (outbox.length > 30) {
      const passive = outbox.findIndex(item => !item.createdIds?.length);
      outbox.splice(passive < 0 ? 0 : passive, 1);
    }
    if (enabled && username) emit(packet);
    retryAttempt = 0;
    scheduleRetry();
  }
  window.addEventListener('x-focus-config-v2', event => {
    try {
      const config = JSON.parse(event.detail);
      if (config.ack) {
        const index = outbox.findIndex(packet => packet.packetId === config.ack);
        if (index >= 0) outbox.splice(index, 1);
        if (!outbox.length) clearRetry();
        return;
      }
      const nextUsername = /^[a-z0-9_]{1,15}$/i.test(config.username || '') ? config.username.toLowerCase() : '';
      const nextEnabled = config.enabled !== false && !!nextUsername;
      const nextBuffer = config.bufferUntilIdentity === true;
      // Identity confirmation may release startup results. A pause, account
      // mismatch or rebinding cancels in-flight work and clears all queued data.
      if ((!nextEnabled && !nextBuffer) || (username && nextUsername !== username)) {
        cancellationEpoch++;
        outbox.length = 0;
        clearRetry();
      }
      username = nextUsername;
      enabled = nextEnabled;
      bufferUntilIdentity = nextBuffer;
      if (!enabled) clearRetry();
      retryAttempt = 0;
      emit({ ready: true, username, enabled, transport: {
        fetch: window.fetch === observedFetch,
        xhr: XMLHttpRequest.prototype.open === observedOpen && XMLHttpRequest.prototype.send === observedSend
      } });
      replay();
    } catch { /* unrelated page events are ignored */ }
  });
  const nativeFetch = window.fetch;
  const observedFetch = function (...args) {
    let op = null;
    try { op = XFocusNetwork.operation(typeof args[0] === 'string' || args[0] instanceof URL ? String(args[0]) : args[0]?.url); } catch {}
    const context = captureContext(op);
    const pending = Reflect.apply(nativeFetch, this, args);
    if (op && context) pending.then(response => {
      if (!response.ok || context.epoch !== cancellationEpoch) return;
      // Read a clone only; the original request and response are untouched.
      try { response.clone().text().then(text => { if (text.length < maxBodySize) { try { handle(JSON.parse(text), op, context); } catch {} } }).catch(() => {}); } catch {}
    }, () => {});
    return pending;
  };
  window.fetch = observedFetch;
  const nativeOpen = XMLHttpRequest.prototype.open, nativeSend = XMLHttpRequest.prototype.send;
  const xhrOps = new WeakMap(), xhrLoads = new WeakMap();
  const observedOpen = function (method, url, ...rest) {
    const previous = xhrLoads.get(this);
    if (previous) { this.removeEventListener('load', previous); xhrLoads.delete(this); }
    xhrOps.set(this, XFocusNetwork.operation(String(url)));
    return Reflect.apply(nativeOpen, this, [method, url, ...rest]);
  };
  const observedSend = function (...args) {
    const op = xhrOps.get(this), context = captureContext(op);
    if (op && context) {
      const onLoad = () => {
        xhrLoads.delete(this);
        if (this.status < 200 || this.status >= 300 || context.epoch !== cancellationEpoch) return;
        try {
          if (this.responseType === 'json') handle(this.response, op, context);
          else if ((!this.responseType || this.responseType === 'text') && this.responseText.length < maxBodySize) handle(JSON.parse(this.responseText), op, context);
        } catch {}
      };
      xhrLoads.set(this, onLoad);
      this.addEventListener('load', onLoad, { once: true });
    }
    return Reflect.apply(nativeSend, this, args);
  };
  XMLHttpRequest.prototype.open = observedOpen;
  XMLHttpRequest.prototype.send = observedSend;
  emit({ hello: true });
})();
