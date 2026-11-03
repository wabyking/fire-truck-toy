// Smoke-test the deployed page: load, start, open the toolbox, start a fire; report errors and save a screenshot.
import { chromium } from 'file:///C:/Users/wangbenyou/lemo-opuscar/node_modules/playwright-core/index.mjs';
const URL = process.argv[2] || 'https://wabyking.github.io/fire-truck-toy/';
const b = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
const t0 = Date.now(); await p.goto(URL); await p.waitForFunction(() => window.TOY, null, { timeout: 90000 });
console.log('loaded in', ((Date.now() - t0) / 1000).toFixed(1), 's');
await p.click('#start', { force: true }); await p.waitForTimeout(1500);
await p.evaluate(() => TOY.ACTIONS.tools()); await p.waitForTimeout(3000);
await p.screenshot({ path: 'D:/huatuo-film-render/online.jpg', type: 'jpeg', quality: 80 });
console.log(errs.length ? errs.join('\n') : 'no page errors'); await b.close();
