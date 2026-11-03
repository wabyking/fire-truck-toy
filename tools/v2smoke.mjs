// v2 smoke test: title -> menu -> each level's opening; screenshots and page errors.
import { chromium } from 'file:///C:/Users/wangbenyou/lemo-opuscar/node_modules/playwright-core/index.mjs';
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || 'D:/huatuo-film-render/v2'; fs.mkdirSync(OUT, { recursive: true });
const only = process.argv[3] ? process.argv[3].split(',').map(Number) : [1, 2, 3, 4, 5, 6, 7, 8];
const b = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1400, height: 860 } });
const errs = []; p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await p.goto(pathToFileURL(path.join(ROOT, 'dist', 'index.html')).href);
await p.waitForFunction(() => window.TOY && window.TOY.G, null, { timeout: 60000 });
await p.click('#start', { force: true }); await p.waitForTimeout(3500);
await p.screenshot({ path: `${OUT}/00_menu.jpg`, type: 'jpeg', quality: 80 });
for (const id of only) {
  await p.evaluate(i => { TOY.progress.best = {}; TOY.startLevel(TOY.LEVELS[i - 1]); }, id);
  await p.waitForTimeout(1200); await p.screenshot({ path: `${OUT}/L${id}_a_intro.jpg`, type: 'jpeg', quality: 80 });
  await p.waitForTimeout(3500); await p.screenshot({ path: `${OUT}/L${id}_b_start.jpg`, type: 'jpeg', quality: 80 });
}
console.log(errs.length ? errs.slice(0, 20).join('\n') : 'no page errors');
await b.close();
