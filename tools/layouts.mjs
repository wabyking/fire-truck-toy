// Screenshots of the menu, a level in play and a result card on phone and tablet sizes (touch), plus page errors.
// usage: node tools/layouts.mjs [outdir]
import { chromium } from 'file:///C:/Users/wangbenyou/lemo-opuscar/node_modules/playwright-core/index.mjs';
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || 'D:/huatuo-film-render/layouts'; fs.mkdirSync(OUT, { recursive: true });
const sizes = { phone: [390, 844], phoneL: [844, 390], ipad: [1180, 820], ipadP: [820, 1180] };
const b = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
const errs = [];
for (const [name, [w, h]] of Object.entries(sizes)) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: name.startsWith('phone') });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(`${name} pageerror: ${e.message}`)); p.on('console', m => { if (m.type() === 'error') errs.push(`${name} console: ${m.text()}`); });
  await p.goto(pathToFileURL(path.join(ROOT, 'dist', 'index.html')).href);
  await p.waitForFunction(() => window.TOY && window.TOY.G, null, { timeout: 60000 });
  await p.click('#start', { force: true }); await p.waitForTimeout(3000);
  await p.screenshot({ path: `${OUT}/${name}_menu.jpg`, type: 'jpeg', quality: 75 });
  await p.evaluate(() => TOY.startLevel(TOY.LEVELS[2])); await p.waitForTimeout(1200);
  await p.screenshot({ path: `${OUT}/${name}_intro.jpg`, type: 'jpeg', quality: 75 });
  await p.waitForTimeout(3500);
  await p.screenshot({ path: `${OUT}/${name}_play.jpg`, type: 'jpeg', quality: 75 });
  // overflow check: any dock button outside the viewport?
  const off = await p.evaluate(() => [...document.querySelectorAll('button')].filter(e => e.offsetParent).map(e => [e.dataset.act || e.id, e.getBoundingClientRect()])
    .filter(([, r]) => r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1 || r.top < -1).map(([n]) => n));
  if (off.length) errs.push(`${name}: off-screen buttons ${off.join(',')}`);
  await ctx.close();
}
console.log(errs.length ? errs.join('\n') : 'no page errors, all buttons on screen');
await b.close();
