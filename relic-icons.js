(() => {
  // Code-native engraved inventory symbols, matching the HUD's existing SVGs.
  const shapes = {
    quill: '<path d="M8 37 34 9M13 31C7 21 23 7 38 6c-1 14-15 31-25 25ZM21 24h10M15 30H9"/>',
    compass: '<circle cx="24" cy="24" r="16"/><circle cx="24" cy="24" r="12"/><path d="m29 15-2 12-12 6 6-12Z"/><path d="M24 4v4m0 32v4M4 24h4m32 0h4"/>',
    key: '<circle cx="17" cy="16" r="9"/><circle cx="17" cy="16" r="4"/><path d="m23 23 16 16m-5-5 5-5m-11-1 5-5M12 7l5-3 5 3"/>',
    ring: '<ellipse cx="24" cy="28" rx="13" ry="14"/><ellipse cx="24" cy="28" rx="9" ry="10"/><path d="m17 12 7-8 7 8-7 7Z"/><path d="M24 4v15m-7-7h14"/>',
    gem: '<path d="m15 8 18 0 8 11-17 23L7 19Z"/><path d="M7 19h34M15 8l4 11 5 23 5-23 4-11M19 19l5-11 5 11"/>',
    scroll: '<path d="M12 9h24v29H13M12 9c-8-6-9 11-2 11h3m23 18c9 7 11-10 3-10h-3M13 9v29c-8 6-10-9-3-10h3"/><path d="M19 15h11m-11 6h11m-11 6h7"/>',
    chalice: '<path d="M13 8h22v7c0 10-22 10-22 0Zm1 2H7v5c0 6 7 8 9 7m18-12h7v5c0 6-7 8-9 7M24 23v15m-9 3 9-4 9 4Z"/><path d="m24 10 4 5-4 5-4-5Z"/>',
    blade: '<path d="m8 40 9-9m-7-4 12 12m-8-12L33 6l8-2-2 9-21 20Z"/><path d="M18 29 36 10m-24 25 3 3"/>',
    feather: '<path d="M8 40C20 26 22 16 36 5c9 19-3 30-20 29M17 34c-8-13 3-24 19-29M21 26l13-2M25 20l10-3M30 13l-3-3"/>',
    lantern: '<path d="M15 13h18l4 22-13 8-13-8ZM13 13l11-7 11 7M19 8V4h10v4M15 34h18M19 15l1 18m9-18-1 18"/><path d="M24 21c-5 7-4 10 0 10s5-3 0-10Z"/>',
    crown: '<path d="m7 14 9 7 8-13 8 13 9-7-5 23H12ZM12 30h24M15 37v4h18v-4"/><circle cx="7" cy="12" r="2"/><circle cx="24" cy="6" r="2"/><circle cx="41" cy="12" r="2"/><path d="m24 22 3 4-3 4-3-4Z"/>',
    seal: '<circle cx="24" cy="21" r="14"/><circle cx="24" cy="21" r="10"/><path d="m16 32-3 13 11-5 11 5-3-13M24 13l2 5 5 3-5 2-2 6-2-6-5-2 5-3Z"/>'
  };
  const icon = kind => `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${shapes[kind] || shapes.gem}</svg>`;
  globalThis.XFocusRelicIcons = { icon };
})();
