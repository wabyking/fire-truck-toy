// Close-up showcase shots of the truck's details (and a short manual drive).
import { chromium } from 'file:///C:/Users/wangbenyou/lemo-opuscar/node_modules/playwright-core/index.mjs';
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || 'D:/huatuo-film-render/show'; fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'index.html')).href);
await page.waitForFunction(() => window.TOY, null, { timeout: 60000 });
await page.click('#start', { force: true }); await page.waitForTimeout(1200);
await page.evaluate(() => { document.getElementById('toast').style.display = 'none'; TOY.truck.pos.set(2, 0, -7); TOY.truck.heading = 0.35; TOY.T.root.position.copy(TOY.truck.pos); TOY.T.root.rotation.y = 0.35; TOY.game.userOrbitUntil = 1e12; });
const view = (p, t) => page.evaluate(([p, t]) => { const tr = TOY.truck.pos, h = TOY.truck.heading, c = Math.cos(h), s = Math.sin(h);
  const w = v => [tr.x + v[0] * c + v[2] * s, v[1], tr.z - v[0] * s + v[2] * c];
  TOY.camera.position.set(...w(p)); TOY.controls.target.set(...w(t)); TOY.controls.update(); }, [p, t]).then(() => page.waitForTimeout(400));
const shot = async (n, ms = 0) => { if (ms) await page.waitForTimeout(ms); await page.screenshot({ path: path.join(OUT, n + '.jpg'), type: 'jpeg', quality: 86 }); };
// front three-quarter, lights flashing
await page.evaluate(() => { TOY.T.state.lights = true; TOY.T.state.headlights = true; });
await view([5.5, 2.4, 10], [0, 1.6, 2.5]); await shot('01_front', 300);
// left side: doors and every bay open
await page.evaluate(() => { const S = TOY.T.state; for (const k in S.doors) S.doors[k] = 1; for (const k in TOY.T.shutters) S.shutters[k] = true; S.lights = false; });
await view([8.5, 2.3, -0.2], [0, 1.6, -0.2]); await shot('02_side_open', 3200);
await view([4.2, 1.9, 0.6], [0, 1.6, 0.6]); await shot('03_bays_close');
// the cab through the open door
await view([3.2, 2.4, 3.6], [0.4, 1.9, 3.2]); await shot('04_cab');
// kerb side: pump panel
await view([-4.2, 1.8, 1.0], [-1.2, 1.6, 0.95]); await page.evaluate(() => { const v = TOY.T.valves[0]; TOY.handleTap('valve', v.v); }); await shot('05_pump', 700);
// rear
await view([-2.5, 2.6, -10], [0, 1.6, -4]); await shot('06_rear');
// ladder up, fountain
await page.evaluate(() => { const S = TOY.T.state; for (const k in S.doors) S.doors[k] = 0; for (const k in TOY.T.shutters) S.shutters[k] = false; TOY.ACTIONS.ladder(); });
await page.waitForTimeout(6500); await page.evaluate(() => { TOY.game.spray = true; });
await view([14, 6, 6], [0, 5, 6]); await shot('07_ladder_spray', 3500);
await page.evaluate(() => { TOY.game.spray = false; TOY.ACTIONS.ladder(); }); await page.waitForTimeout(6000);
// drive with the pad
await page.evaluate(() => { TOY.game.userOrbitUntil = 0; });
const up = await page.$('[data-pad=up]'), left = await page.$('[data-pad=left]');
const bu = await up.boundingBox(), bl = await left.boundingBox();
await page.mouse.move(bu.x + bu.width / 2, bu.y + bu.height / 2); await page.mouse.down(); await page.waitForTimeout(2500);
await page.mouse.up(); await page.mouse.move(bl.x + bl.width / 2, bl.y + bl.height / 2); await page.mouse.down(); await page.waitForTimeout(300);
await page.mouse.up(); await page.mouse.move(bu.x + bu.width / 2, bu.y + bu.height / 2); await page.mouse.down(); await page.waitForTimeout(1500); await shot('08_drive');
await page.mouse.up();
console.log(await page.evaluate(() => ({ pos: TOY.truck.pos.toArray().map(v => +v.toFixed(1)), speed: +TOY.truck.speed.toFixed(2) })));
console.log(errs.length ? errs.join('\n') : 'no page errors');
await browser.close();
