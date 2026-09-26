(() => {
  if (window.__xFocusObserverV2) return;
  Object.defineProperty(window, '__xFocusObserverV2', { value: true });
  let username = '', enabled = true;
  const outbox = [];
  const eventName = 'x-focus-data-v2';
  function emit(detail) { window.dispatchEvent(new CustomEvent(eventName, { detail: JSON.stringify(detail) })); }
  function handle(payload, op) {
    if (!enabled || !username) return;
    const result = XFocusNetwork.parse(payload, op, username);
    if (!result.followers && typeof result.blueVerified !== 'boolean' && !result.posts.length) return;
    const detail = { ...result, operation: op, capturedAt: new Date().toISOString() };
    // Keep a small sanitized queue until the isolated content script acknowledges.
    const packet = { ...detail, packetId: crypto.randomUUID() };
    outbox.push(packet); if (outbox.length > 30) outbox.shift();
    emit(packet);
  }
  window.addEventListener('x-focus-config-v2', event => {
    try {
      const config = JSON.parse(event.detail);
      if (config.ack) { const index = outbox.findIndex(p => p.packetId === config.ack); if (index >= 0) outbox.splice(index, 1); return; }
      const nextUsername = /^[a-z0-9_]{1,15}$/i.test(config.username || '') ? config.username.toLowerCase() : '';
      if (nextUsername !== username || config.enabled === false) outbox.length = 0;
      username = nextUsername;
      enabled = config.enabled !== false;
      emit({ ready: true, username, enabled });
      for (const packet of outbox) emit(packet);
    } catch { /* unrelated page events are ignored */ }
  });
  const nativeFetch = window.fetch;
  window.fetch = function (...args) {
    let op = null;
    try { op = XFocusNetwork.operation(typeof args[0] === 'string' || args[0] instanceof URL ? String(args[0]) : args[0]?.url); } catch {}
    const pending = Reflect.apply(nativeFetch, this, args);
    if (op) pending.then(response => {
      if (!response.ok || !enabled || !username) return;
      // Read a clone only; the original response is returned untouched to X.
      try { response.clone().text().then(text => { if (text.length < 8 * 1024 * 1024) { try { handle(JSON.parse(text), op); } catch {} } }).catch(() => {}); } catch {}
    }, () => {});
    return pending;
  };
  const nativeOpen = XMLHttpRequest.prototype.open, nativeSend = XMLHttpRequest.prototype.send;
  const xhrOps = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    xhrOps.set(this, XFocusNetwork.operation(String(url)));
    return Reflect.apply(nativeOpen, this, [method, url, ...rest]);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const op = xhrOps.get(this);
    if (op) this.addEventListener('load', () => {
      if (this.status < 200 || this.status >= 300 || !enabled || !username) return;
      try {
        if (this.responseType === 'json') handle(this.response, op);
        else if ((!this.responseType || this.responseType === 'text') && this.responseText.length < 8 * 1024 * 1024) handle(JSON.parse(this.responseText), op);
      } catch {}
    }, { once: true });
    return Reflect.apply(nativeSend, this, args);
  };
  emit({ hello: true });
})();
