// Play through the toy in a headless browser and take screenshots of each moment; prints page errors.
// usage: node tools/shots.mjs <outdir> [scenario]
import { chromium } from 'file:///C:/Users/wangbenyou/lemo-opuscar/node_modules/playwright-core/index.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || 'D:/huatuo-film-render/toy';
const SCEN = process.argv[3] || 'all';
fs.mkdirSync(OUT, { recursive: true });
const W = +(process.env.W || 1600), H = +(process.env.H || 900);
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'index.html')).href);
await page.waitForFunction(() => window.TOY, null, { timeout: 60000 });
const wait = ms => page.waitForTimeout(ms);
let n = 0;
const shot = async name => { await page.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, '0')}_${name}.jpg`), type: 'jpeg', quality: 82 }); };
const ev = (fn, arg) => page.evaluate(fn, arg);

await shot('title');
await page.click('#start', { force: true }); await wait(2500); await shot('start');
if (SCEN === 'all' || SCEN === 'truck') {
  await ev(() => TOY.ACTIONS.doors()); await wait(1500); await shot('doors');
  await ev(() => TOY.ACTIONS.doors()); await ev(() => TOY.ACTIONS.tools()); await wait(3200); await shot('tools');
  await ev(() => { const tl = TOY.T.tools.find(t => t.kind === 'extinguisher'); TOY.handleTap('tool:extinguisher', tl.o); }); await wait(900); await shot('tool_pop');
  await ev(() => TOY.ACTIONS.tools()); await wait(500);
  // a view of the pump panel and a valve squirt
  await ev(() => { const v = TOY.T.valves[1]; TOY.handleTap('valve', v.v); TOY.controls.target.set(-1.5, 1.5, TOY.truck.pos.z + 1); TOY.camera.position.set(-8, 2.5, TOY.truck.pos.z + 1.5); TOY.game.userOrbitUntil = performance.now() / 1000 + 5; }); await wait(1200); await shot('valve');
  await ev(() => { TOY.camera.position.set(-14, 9, TOY.truck.pos.z + 14); TOY.ACTIONS.ladder(); }); await wait(6000); await shot('ladder_up');
  await ev(() => { TOY.game.spray = true; }); await wait(3500); await shot('spray_fountain'); await ev(() => { TOY.game.spray = false; });
  await ev(() => TOY.ACTIONS.ladder()); await wait(5000);
  await ev(() => { TOY.ACTIONS.lights(); TOY.camera.position.set(6, 3.2, TOY.truck.pos.z + 12); TOY.game.userOrbitUntil = performance.now() / 1000 + 5; }); await wait(1200); await shot('front_lights');
}
if (SCEN === 'all' || SCEN === 'fire') {
  await ev(() => TOY.startFire(0)); await wait(1500); await shot('fire_alarm');
  await ev(() => { const h = TOY.W.houses[0]; TOY.driveTo(h.parkAt.clone(), true); }); await wait(3000); await shot('driving');
  await page.waitForFunction(() => !TOY.truck.target, null, { timeout: 40000 }).catch(() => {});
  await wait(800); await shot('arrived');
  await ev(() => { TOY.game.spray = true; }); await wait(5000); await shot('spraying');
  await page.waitForFunction(() => !TOY.fires.some(f => f.active), null, { timeout: 30000 }).catch(() => {});
  await wait(600); await shot('fire_out'); await ev(() => { TOY.game.spray = false; }); await wait(2500); await shot('celebrate');
}
if (SCEN === 'all' || SCEN === 'cat') {
  await ev(() => { const c = TOY.W.cat.tree.position; TOY.driveTo(c.clone().add({ x: 8, y: 0, z: -2 })); });
  await page.waitForFunction(() => !TOY.truck.target, null, { timeout: 40000 }).catch(() => {});
  await wait(500); await shot('at_cat_tree');
  await ev(() => TOY.ACTIONS.ladder()); await wait(2500); await shot('cat_raise'); await wait(1500); await shot('cat_reach');
  await page.waitForFunction(() => TOY.game.catPhase === 'riding', null, { timeout: 20000 }).catch(() => {}); await wait(300); await shot('cat_hop');
  await page.waitForFunction(() => TOY.game.catPhase === 'saved', null, { timeout: 30000 }).catch(() => {});
  await wait(2500); await shot('cat_saved');
}
console.log(errs.length ? errs.slice(0, 25).join('\n') : 'no page errors');
const fps = await ev(() => new Promise(r => { let k = 0; const t0 = performance.now(); const f = () => (++k < 60 ? requestAnimationFrame(f) : r(60000 / (performance.now() - t0))); requestAnimationFrame(f); }));
console.log('fps (headless)', fps.toFixed(1));
await browser.close();
