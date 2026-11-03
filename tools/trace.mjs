// trace a level: start it, run an action, then print state every 2 s
// usage: node tools/trace.mjs <level> "<action js>" [seconds]
import { chromium } from 'file:///C:/Users/wangbenyou/lemo-opuscar/node_modules/playwright-core/index.mjs';
import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [lv, act, secs = 30] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
p.on('pageerror', e => console.log('pageerror', e.message));
await p.goto(pathToFileURL(path.join(ROOT, 'dist', 'index.html')).href);
await p.waitForFunction(() => window.TOY && window.TOY.G, null, { timeout: 60000 });
await p.click('#start', { force: true }); await p.waitForTimeout(3000);
await p.evaluate(i => TOY.startLevel(TOY.LEVELS[i - 1]), +lv); await p.waitForTimeout(3600);
await p.evaluate(a => eval(a), act);
for (let i = 0; i < secs / 2; i++) {
  await p.waitForTimeout(2000);
  console.log(JSON.stringify(await p.evaluate(() => { const G = TOY.G, tr = G.truck, S = TOY.T.state, r = (v, n = 1) => v && v.toArray ? v.toArray().map(x => +x.toFixed(n)) : v;
    return { t: Math.round(TOY.levelT), pos: r(tr.pos), sp: +tr.speed.toFixed(1), tgt: r(tr.target), route: tr.route ? tr.route.length : 0, back: +(tr.backing || 0).toFixed(1),
      cat: G.rescues.cat.phase, dog: G.rescues.dog.phase, elev: +S.elev.toFixed(2), ext: +S.ext.toFixed(2), yaw: +S.yaw.toFixed(2), tank: Math.round(S.tank), refill: !!G.refilling,
      flags: Object.keys(G.flags).join(','), next: TOY.L && TOY.L.next }; })));
}
await p.screenshot({ path: 'D:/huatuo-film-render/trace.jpg', type: 'jpeg', quality: 80 });
await b.close();
