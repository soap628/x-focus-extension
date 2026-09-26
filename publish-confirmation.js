// Passive fallback for an explicit composer submission followed by X's own
// success toast. A button click alone never creates a recorded action.
(() => {
  const composerSelector = '[data-testid^="tweetTextarea_"]';
  const submitSelector = '[data-testid="tweetButton"],[data-testid="tweetButtonInline"]';
  const toastSelector = '[data-testid="toast"],[role="alert"],[role="status"]';
  const lifetime = 120000;
  const normalize = text => String(text || '').replace(/\s+/g, ' ').trim();
  const visible = node => !!node && !node.closest('[hidden],[aria-hidden="true"]')
    && (typeof node.getClientRects !== 'function' || node.getClientRects().length > 0);
  function buttonKind(button) {
    if (!visible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') return null;
    const label = normalize(button.textContent);
    if (/^(Post|Tweet|发帖|发布|發帖|發布|發佈)$/i.test(label)) return 'posts';
    if (/^(Reply|回复|回覆)$/i.test(label)) return 'replies';
    return null;
  }
  function composers(document) {
    return [...document.querySelectorAll(composerSelector)].filter(node => /^tweetTextarea_\d+$/.test(node.getAttribute('data-testid') || '')
      && visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true'
      && (node.matches('textarea') || node.getAttribute('contenteditable') === 'true'));
  }
  function localButtons(composer) {
    // Stop before a whole page could associate unrelated controls. X's inline
    // and dialog composers keep the textbox and submit control in a local div.
    let container = composer.parentElement;
    for (let depth = 0; container && depth < 8; depth++, container = container.parentElement) {
      if (container.matches('body,html,main,[role="main"],nav,header')) return [];
      const buttons = [...container.querySelectorAll(submitSelector)].filter(button => buttonKind(button));
      if (buttons.length) return buttons;
    }
    return [];
  }
  function statusLink(link) {
    try {
      const url = new URL(link.getAttribute('href'), 'https://x.com');
      if (url.protocol !== 'https:' || !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname)) return null;
      const match = url.pathname.match(/^\/(?:([a-z0-9_]{1,15})\/status|i\/web\/status)\/(\d{1,20})\/?$/i);
      return match ? { username: match[1]?.toLowerCase() || null, id: match[2] } : null;
    } catch { return null; }
  }
  function toastKind(node) {
    const text = normalize(node.textContent);
    if (/^Your (?:reply) (?:was|has been) (?:sent|posted|published)\b/i.test(text)
      || /^(?:(?:你的|您的|你|您)\s*)?(?:回复|回覆)(?:已(?:成功)?(?:发送|發送|发布|發佈|發表)|(?:发送|發送|发布|發佈)成功)/.test(text)) return 'replies';
    if (/^Your (?:post|tweet) (?:was|has been) (?:sent|posted|published)\b/i.test(text)
      || /^(?:(?:你的|您的|你|您)\s*)?(?:帖子|贴文|貼文|推文)(?:已(?:成功)?(?:发送|發送|发布|發佈|發表)|(?:发送|發送|发布|發佈)成功)/.test(text)) return 'posts';
    return null;
  }
  function mount({ document, username, onConfirmed, now = () => Date.now() }) {
    let pending = null, destroyed = false;
    const seen = new Set(), inFlight = new Set();
    const timestamp = () => { const value = now(); return value instanceof Date ? value.getTime() : Number(value); };
    const account = () => { const value = username(); return typeof value === 'string' && /^[a-z0-9_]{1,15}$/i.test(value) ? value.toLowerCase() : ''; };
    const toasts = () => [...document.querySelectorAll(toastSelector)].filter(visible);
    function snapshotIds() {
      // Baseline all existing toast links, even when their current text is not
      // a success message. Re-rendering an old toast cannot create a new action.
      return new Set(toasts().flatMap(toast => [...toast.querySelectorAll('a[href]')].map(statusLink).filter(Boolean).map(link => link.id)));
    }
    function attempt(button) {
      const owner = account(), kind = buttonKind(button), active = composers(document), at = timestamp();
      if (!owner || !kind || active.length !== 1 || !Number.isFinite(at)) { pending = null; return; }
      const buttons = localButtons(active[0]);
      if (buttons.length !== 1 || buttons[0] !== button) { pending = null; return; }
      pending = { username: owner, kind, at, baseline: snapshotIds(), candidate: null };
    }
    function click(event) {
      const button = event.target?.closest?.(submitSelector);
      if (!button || (event.button !== undefined && event.button !== 0)) return;
      attempt(button);
    }
    function keydown(event) {
      if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.repeat || event.isComposing) return;
      const active = composers(document), target = document.activeElement;
      if (active.length !== 1 || !(active[0] === target || active[0].contains(target))
        || !(active[0] === event.target || active[0].contains(event.target))) { pending = null; return; }
      const buttons = localButtons(active[0]);
      if (buttons.length !== 1) { pending = null; return; }
      attempt(buttons[0]);
    }
    function createdAt(id, attemptAt, current) {
      try {
        const number = BigInt(id);
        if (number <= 0n || number > 18446744073709551615n) return null;
        const at = Number(number >> 22n) + 1288834974657;
        // The ID timestamp must belong to this submission window. Never infer
        // "now" for an invalid ID or recover an unrelated historic toast.
        if (!Number.isSafeInteger(at) || at < attemptAt || at > current + 5000 || at < current - lifetime) return null;
        return new Date(at).toISOString();
      } catch { return null; }
    }
    async function scan() {
      if (destroyed || !pending) return;
      const attempt = pending, current = timestamp();
      if (!Number.isFinite(current) || current < attempt.at || current - attempt.at > lifetime || account() !== attempt.username) { pending = null; return; }
      if (!attempt.candidate) {
        const matches = new Map();
        for (const toast of toasts()) {
          if (/^(?:Your (?:post|reply|tweet) (?:was not|could not be) (?:sent|posted|published)|Failed to (?:send|post)|Something went wrong|发送失败|發送失敗|发布失败|發布失敗|出错了|出錯了)/i.test(normalize(toast.textContent))) { pending = null; return; }
          const kind = toastKind(toast);
          // X may use "Your post was sent" for replies too. A reply-specific
          // success message cannot confirm an intent labelled as an original.
          if (!kind || (kind === 'replies' && attempt.kind !== 'replies')) continue;
          for (const link of toast.querySelectorAll('a[href]')) {
            const result = statusLink(link);
            if (!result || (result.username && result.username !== attempt.username)
              || seen.has(result.id) || attempt.baseline.has(result.id)) continue;
            const date = createdAt(result.id, attempt.at, current);
            if (date) matches.set(result.id, { id: result.id, kind: attempt.kind, createdAt: date, text: '', views: null, approximate: false });
          }
        }
        if (matches.size !== 1) return;
        attempt.candidate = matches.values().next().value;
      }
      const candidate = attempt.candidate;
      if (seen.has(candidate.id) || inFlight.has(candidate.id)) return;
      inFlight.add(candidate.id);
      try {
        await onConfirmed({ ...candidate });
        seen.add(candidate.id);
        if (seen.size > 500) seen.delete(seen.values().next().value);
        if (pending === attempt) pending = null;
      } catch { /* A later scan retries this sanitized candidate until expiry. */ }
      finally { inFlight.delete(candidate.id); }
    }
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', keydown, true);
    return { scan, destroy() { destroyed = true; pending = null; document.removeEventListener('click', click, true); document.removeEventListener('keydown', keydown, true); } };
  }
  globalThis.XFocusPublishConfirmation = { mount };
})();
