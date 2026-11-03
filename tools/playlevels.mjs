// Play every level to the end the way a child would (through the same actions the buttons and taps call),
// and report: finished?, stars, time, page errors. Screenshots of the key moment and the result go to OUT.
// usage: node tools/playlevels.mjs [outdir] [levels e.g. 1,3,8]
import { chromium } from 'file:///C:/Users/wangbenyou/lemo-opuscar/node_modules/playwright-core/index.mjs';
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || 'D:/huatuo-film-render/play'; fs.mkdirSync(OUT, { recursive: true });
const only = process.argv[3] ? process.argv[3].split(',').map(Number) : [1, 2, 3, 4, 5, 6, 7, 8];
const b = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1400, height: 860 } });
const errs = []; p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await p.goto(pathToFileURL(path.join(ROOT, 'dist', 'index.html')).href);
await p.waitForFunction(() => window.TOY && window.TOY.G, null, { timeout: 60000 });
await p.click('#start', { force: true }); await p.waitForTimeout(3000);
const ev = (f, a) => p.evaluate(f, a);
const wait = ms => p.waitForTimeout(ms);
const until = (f, ms = 60000, arg = null) => p.waitForFunction(f, arg, { timeout: ms, polling: 250 }).then(() => true).catch(() => false);
const shot = n => p.screenshot({ path: `${OUT}/${n}.jpg`, type: 'jpeg', quality: 80 });
const arrive = () => until(() => !TOY.G.truck.target && Math.abs(TOY.G.truck.speed) < 0.2, 60000);
const sprayUntil = async (f, ms = 60000) => { await ev(() => { TOY.G.spray = true; }); const ok = await until(f, ms); await ev(() => { TOY.G.spray = false; }); return ok; };

const plays = {
  1: async () => {
    await ev(() => TOY.G.actions.doors()); await wait(1200);
    await ev(() => TOY.G.actions.tools()); await wait(3000);
    await ev(() => { const tl = TOY.T.tools.find(t => t.kind === 'helmet'); TOY.G.handleTap('tool:helmet', tl.o); }); await wait(1200); await shot('L1_tool');
    await ev(() => TOY.G.actions.lights()); await wait(800); await ev(() => TOY.G.actions.bell());
  },
  2: async () => {
    await ev(() => TOY.G.actions.siren()); await wait(1500);
    for (let i = 0; i < 3; i++) {
      await ev(i => TOY.G.driveTo(TOY.L.points[i].position.clone()), i); await wait(500); if (i === 1) await shot('L2_drive');
      await until(i => TOY.L.next > i, 60000, i);
    }
    await ev(() => TOY.G.driveTo(TOY.L.box.position.clone())); await arrive(); await wait(800);
    if (!(await ev(() => TOY.G.flags.parked))) { await ev(() => TOY.G.driveTo(TOY.L.box.position.clone().add(new TOY.THREE.Vector3(0, 0, 0.5)))); await arrive(); await wait(800); }
  },
  3: async () => { await ev(() => TOY.G.actions.siren()); await wait(800); await ev(() => TOY.G.actions.fire()); await arrive(); await wait(500); await ev(() => { TOY.G.spray = true; }); await wait(4000); await shot('L3_spray'); await sprayUntil(() => TOY.G.flags.fireOut); },
  4: async () => { await ev(() => TOY.G.handleTap('cat', TOY.W.cat.group, null)); await wait(9000); await shot('L4_reach'); await until(() => TOY.G.flags.catSaved, 60000); },
  5: async () => {
    await ev(() => TOY.G.hydrantTap(TOY.W.hydrants[1])); await until(() => TOY.G.refilling, 40000); await wait(1500); await shot('L5_refill');
    await until(() => TOY.G.flags.refilled, 30000);
    await ev(() => TOY.G.actions.fire()); await arrive(); await wait(500); await sprayUntil(() => TOY.G.flags.fireOut);
  },
  6: async () => {
    for (let k = 1; k <= 2; k++) {
      await ev(() => TOY.G.actions.fire()); await arrive(); await wait(500);
      if (k === 2) { await ev(() => { TOY.G.spray = true; }); await wait(3500); await shot('L6_second'); }
      await ev(() => { TOY.G.spray = true; }); await until(k => (TOY.G.flags.fireOut || 0) >= k, 60000, k); await ev(() => { TOY.G.spray = false; });
      if (await ev(() => TOY.T.state.tank < 30)) { await ev(() => TOY.G.hydrantTap(TOY.W.hydrants[0])); await until(() => TOY.G.flags.refilled, 50000); }
    }
  },
  7: async () => {
    await ev(() => TOY.G.actions.fire()); await arrive(); await wait(500);
    await ev(() => { TOY.G.spray = true; }); await wait(6000); await ev(() => { TOY.G.spray = false; });
    const said = await ev(() => !!TOY.G.said.need_foam); console.log('   L7 water did not work, hint said:', said);
    await ev(() => TOY.G.actions.agent()); await wait(800);
    await ev(() => { TOY.G.spray = true; }); await wait(3000); await shot('L7_foam'); await sprayUntil(() => TOY.G.flags.fireOut);
  },
  8: async () => {
    await ev(() => TOY.G.handleTap('dog', TOY.W.dog.group, null)); await wait(10000); await shot('L8_dog');
    await until(() => TOY.G.flags.dogSaved, 60000);
    await ev(() => TOY.G.actions.fire()); await arrive(); await wait(500);
    await ev(() => { TOY.G.spray = true; }); await wait(3500); await shot('L8_spray'); await sprayUntil(() => TOY.G.flags.fireOut);
  },
};
for (const id of only) {
  await ev(i => { TOY.startLevel(TOY.LEVELS[i - 1]); }, id); await wait(3600);
  const t0 = Date.now();
  await plays[id]();
  const done = await until(() => TOY.mode === 'result', 15000);
  await wait(2500); await shot(`L${id}_result`);
  const r = await ev(() => ({ best: TOY.progress.best, t: Math.round(TOY.levelT) }));
  console.log(`L${id}: ${done ? 'FINISHED' : 'NOT FINISHED'}  stars=${r.best[id] || 0}  levelTime=${r.t}s  wall=${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
console.log(errs.length ? errs.slice(0, 20).join('\n') : 'no page errors');
await b.close();
