// Tap real 3D parts with the mouse (at their projected screen positions) and check that each tap does its job.
import { chromium } from 'file:///C:/Users/wangbenyou/lemo-opuscar/node_modules/playwright-core/index.mjs';
import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, hasTouch: false });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(pathToFileURL(path.join(ROOT, 'dist', 'index.html')).href);
await page.waitForFunction(() => window.TOY, null, { timeout: 60000 });
await page.click('#start', { force: true }); await page.waitForTimeout(1500);
// a fixed side view of the left side, close enough to hit small parts
const view = (pos, tgt) => page.evaluate(([p, t]) => { TOY.game.userOrbitUntil = 1e12; TOY.camera.position.set(...p); TOY.controls.target.set(...t); TOY.controls.update(); }, [pos, tgt]).then(() => page.waitForTimeout(250));
const screenOf = name => page.evaluate(n => {
  const o = TOY.T.N[n] || TOY.scene.getObjectByName(n); const v = o.getWorldPosition(new (TOY.camera.position.constructor)());
  if (n.startsWith('Door_')) v.add(new (TOY.camera.position.constructor)(0, 0.6, 0).add(new (TOY.camera.position.constructor)(0, 0, -0.5).applyQuaternion(o.getWorldQuaternion(new (TOY.camera.quaternion.constructor)()))));
  if (n.startsWith('Shutter_')) v.y -= 0.5;
  if (n.startsWith('Valve_')) { v.y += 0.12; v.x -= 0.1; }
  if (n.startsWith('Kid_')) v.y += 0.62;
  TOY.camera.updateMatrixWorld(); const p = v.project(TOY.camera); return [(p.x + 1) / 2 * innerWidth, (1 - p.y) / 2 * innerHeight];
}, name);
const tap = async (name, check) => {
  const [x, y] = await screenOf(name); await page.mouse.click(x, y); await page.waitForTimeout(500);
  const ok = await page.evaluate(check); console.log((ok ? 'OK  ' : 'FAIL') + ' tap ' + name.padEnd(18) + ` @ ${x.toFixed(0)},${y.toFixed(0)}`);
};
// park the truck in the open first (out of the station), facing +z
await page.evaluate(() => { TOY.truck.pos.set(0, 0, -6); TOY.truck.heading = 0; TOY.T.root.position.copy(TOY.truck.pos); TOY.T.root.rotation.y = 0; TOY.T.kids.jiawen.t = -99; TOY.T.kids.bowen.t = -99; });
await page.waitForTimeout(300);
const tz = -6;
await view([9, 2.2, tz + 1], [0, 1.6, tz + 1]);                 // the truck's left side (+x): doors, open bays
await tap('Door_FL', () => TOY.T.state.doors.FL === 1);
await tap('Shutter_L_B', () => !!TOY.T.state.shutters.LB);
await view([-9, 2.2, tz + 1], [0, 1.6, tz + 1]);                // the kerb side (-x): the pump panel
await tap('Valve_2', () => TOY.game.squirts.length > 0 || TOY.T.valves[1].t > 0);
await view([-3, 2.0, tz + 9], [0, 1.2, tz + 4.5]);              // the front: the bell
await tap('Bell', () => TOY.T.state.t - TOY.T.state.bellT < 1.5);
await view([2, 2.4, tz - 9.5], [0, 1.8, tz - 4]);               // the rear: the hose reel
await tap('Hose_Reel', () => TOY.T.state.reelV > 1);
await view([1.5, 3.0, tz + 8], [0, 2.2, tz + 2.8]);             // through the windscreen: 佳文
await tap('Kid_Jiawen', () => TOY.T.state.t - TOY.T.kids.jiawen.t < 2);
// the ground: tap a spot in front of the truck and see it become the drive target
await view([-10, 12, tz + 16], [0, 0, tz + 8]);
const [gx, gy] = await page.evaluate(() => { TOY.camera.updateMatrixWorld(); const v = new (TOY.camera.position.constructor)(4, 0, 6).project(TOY.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; });
await page.mouse.click(gx, gy); await page.waitForTimeout(300); console.log('ground click at', gx.toFixed(0), gy.toFixed(0));
console.log((await page.evaluate(() => !!TOY.truck.target) ? 'OK  ' : 'FAIL') + ' tap ground -> drive target');
console.log(errs.length ? errs.join('\n') : 'no page errors');
await browser.close();
