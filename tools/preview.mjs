import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };
const allowed = new Set(['hud-preview.html', 'hud-preview.js', 'hud-theme.js', 'hud.js', 'hud-state.js', 'assessment.js', 'rewards.js', 'i18n.js', 'relic-icons.js', 'options-i18n.js', 'sidepanel.html', 'app.js', 'styles.css', 'core.js', 'assets/ranger-portrait-v1.png', 'assets/ornate-panel-v1.png', 'assets/treasure-chest-v1.png']);
export function createPreviewServer() { return http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const requested = url.pathname === '/' ? 'hud-preview.html' : decodeURIComponent(url.pathname).slice(1);
    const target = path.resolve(root, requested);
    if (!target.startsWith(root) || !allowed.has(requested)) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'text/plain', 'Cache-Control': 'no-store' });
    res.end(await fs.readFile(target));
  } catch { res.writeHead(500); res.end('Unable to load preview'); }
}); }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createPreviewServer().listen(4317, '127.0.0.1', () => console.log('X Focus preview: http://127.0.0.1:4317'));
}
