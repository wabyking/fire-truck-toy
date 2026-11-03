// Measure where a frame's time goes: GPU name, draw calls, triangles, render time with and without shadows / pixel ratio.
import { chromium } from 'file:///C:/Users/wangbenyou/lemo-opuscar/node_modules/playwright-core/index.mjs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'index.html')).href);
await page.waitForFunction(() => window.TOY, null, { timeout: 60000 });
await page.click('#start', { force: true }); await page.waitForTimeout(2000);
const r = await page.evaluate(() => {
  const { renderer, scene, camera } = TOY;
  const gl = renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '?';
  const time = (n = 20) => { gl.finish(); const t0 = performance.now(); for (let i = 0; i < n; i++) { renderer.render(scene, camera); } gl.finish(); return (performance.now() - t0) / n; };
  renderer.info.autoReset = true; renderer.render(scene, camera);
  const info = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
  const full = time();
  renderer.shadowMap.enabled = false; scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); }); renderer.render(scene, camera);
  const noShadow = time();
  renderer.shadowMap.enabled = true; scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); });
  const pr = renderer.getPixelRatio();
  return { gpu, ...info, full: full.toFixed(1), noShadow: noShadow.toFixed(1), pr, dpr: devicePixelRatio };
});
console.log(JSON.stringify(r));
await browser.close();
