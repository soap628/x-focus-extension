import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPreviewServer } from '../tools/preview.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
const assets = ['assets/ranger-portrait-v1.png', 'assets/ornate-panel-v1.png', 'assets/treasure-chest-v1.png'];
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

test('every runtime file named in the manifest exists inside the extension directory', async () => {
  const references = [
    manifest.background.service_worker,
    manifest.options_ui.page,
    ...manifest.content_scripts.flatMap(script => [...(script.js || []), ...(script.css || [])]),
    ...manifest.web_accessible_resources.flatMap(group => group.resources)
  ];
  for (const reference of references) {
    const resolved = path.resolve(root, reference);
    assert.ok(!path.relative(root, resolved).startsWith('..'), `${reference} must stay inside the extension`);
    assert.ok((await fs.stat(resolved)).isFile(), `missing runtime file: ${reference}`);
  }
});

test('only the three HUD images are exposed, and only to X pages', () => {
  assert.equal(manifest.web_accessible_resources.length, 1);
  const rule = manifest.web_accessible_resources[0];
  assert.deepEqual([...rule.resources].sort(), [...assets].sort());
  assert.deepEqual([...rule.matches].sort(), ['https://www.x.com/*', 'https://x.com/*'].sort());
  assert.ok(!rule.extension_ids?.length, 'other extensions do not need access to the HUD images');
  assert.ok(rule.resources.every(resource => !resource.includes('*')));
});

test('preview serves the actual PNG assets with image MIME and denies unlisted files', async t => {
  const server = createPreviewServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const asset of assets) {
    const response = await fetch(`${origin}/${asset}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes.subarray(0, 8), pngSignature);
    assert.deepEqual(bytes, await fs.readFile(path.join(root, asset)));
  }
  for (const denied of ['/manifest.json', '/assets/not-allowed.png', '/assets/../manifest.json', '/assets/%2e%2e%2fmanifest.json']) {
    const response = await fetch(`${origin}${denied}`);
    assert.equal(response.status, 404, denied);
    await response.text();
  }
});
