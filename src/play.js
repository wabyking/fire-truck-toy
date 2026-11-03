// The gameplay engine: driving, tapping, the ladder, water and foam, the tank and the hydrants, fires, rescues (the kitten
// in the tree, the puppy on the balcony), traffic, camera modes, day and night. Levels drive it through G and listen to
// its events (G.on('fireOut', ...)).
import * as THREE from 'three';
import { animateTruck, nozzleWorld, tipWorld, aimLadder, stowLadder, ladderBusy } from './truck.js';
import { STATION, LIMIT, ROAD, buildCar } from './world.js';
import { Fire, scorch } from './fx.js';
import * as A from './audio.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const TOOL_NAMES = { extinguisher: '灭火器', hose: '水带', helmet: '头盔', axe: '消防斧', cone: '路锥', firstaid: '急救箱', flashlight: '手电筒', boots: '消防靴', rope: '安全绳', pole: '消防钩' };
export const START = { apron: { pos: V(0, 0, STATION.pos.z + 10.5), heading: 0 }, inside: { pos: V(0, 0, STATION.pos.z + 0.8), heading: 0 } };

export function createPlay({ scene, camera, controls, W, T, fx, traffic, ui, lights }) {
  const S = T.state;
  const G = {
    T, W, fx, traffic, scene, camera, controls,
    truck: { pos: START.apron.pos.clone(), heading: 0, speed: 0, steer: 0, target: null, urgent: false, manual: { thr: 0, str: 0 }, onArrive: null },
    flags: {}, said: {}, spray: false, squirts: [], camMode: 'follow', userOrbitUntil: 0, engine: false, t: 0, freeFires: false, nextFireAt: 1e9,
    listeners: {},
  };
  const truck = G.truck;
  G.on = (ev, fn) => { (G.listeners[ev] ||= []).push(fn); };
  G.off = () => { G.listeners = {}; };
  const emit = (ev, ...a) => { G.flags[ev] = (G.flags[ev] || 0) + 1; (G.listeners[ev] || []).forEach(f => f(...a)); };
  G.emit = emit;
  const say = (id, o) => ui.say(id, o);
  const sayOnce = id => { if (!G.said[id]) { G.said[id] = 1; say(id); return true; } return false; };
  G.say = say; G.sayOnce = sayOnce;
  const setBtn = (id, on) => ui.setBtn(id, on), pulse = (id, on) => ui.pulse(id, on);

  // ---------------------------------------------------------------- fires: five houses and a car
  G.fires = W.houses.map((h, i) => { const f = new Fire(scene, h.fireWorld, 1.3); f.site = { kind: 'house', house: h, parkAt: h.parkAt.clone(), normal: h.front.clone() }; return f; });
  // a second fire spot on house 0 (the other upstairs window), used by the night level
  {
    const h = W.houses[0], wnd = h.windows[1];
    const p = wnd.position.clone().add(V(0, 0.1, 0.25)).applyMatrix4(h.group.matrixWorld);
    const f = new Fire(scene, p, 1.2); f.site = { kind: 'house', house: h, parkAt: h.parkAt.clone(), normal: h.front.clone(), window: wnd }; G.fires.push(f); G.fireH0b = f;
  }
  // the car on the road: parked, and an oil fire on its bonnet (water does not work, foam does)
  const carA = 1.25, car = buildCar('#9aa3ad'); car.position.set(Math.cos(carA) * (ROAD.r + 1.8), 0, Math.sin(carA) * (ROAD.r + 1.8)); car.rotation.y = -carA; scene.add(car); car.visible = false;
  const carFire = new Fire(scene, car.position.clone().add(V(-Math.sin(carA) * 1.0, 1.0, Math.cos(carA) * 1.0)), 1.1);
  carFire.oil = true; carFire.site = { kind: 'car', car, parkAt: V(Math.cos(carA - 0.62) * (ROAD.r + 0.5), 0, Math.sin(carA - 0.62) * (ROAD.r + 0.5)), normal: V(Math.cos(carA), 0, Math.sin(carA)) };
  G.fires.push(carFire); G.carFire = carFire; G.burntCar = car;
  car.traverse(o => { if (o.isMesh) o.userData.fire = carFire; });
  const scorches = [];

  // ---------------------------------------------------------------- rescues: the kitten in the tree, the puppy on the balcony
  const rescues = {
    cat: { key: 'cat', ...W.cat, phase: 'idle', enabled: true, ask: 'cat', saved: 'cat_saved', sound: () => A.meow(), event: 'catSaved' },
    dog: { key: 'dog', ...W.dog, phase: 'idle', enabled: false, ask: 'dog', saved: 'dog_saved', sound: () => A.bark(), event: 'dogSaved' },
  };
  G.rescues = rescues;
  const spotFor = r => {
    if (r.key === 'cat') { const c = r.group.getWorldPosition(V()), a = Math.atan2(c.z, c.x); return V(Math.cos(a) * (ROAD.r - 1), 0, Math.sin(a) * (ROAD.r - 1)); }   // the road nearest the kitten
    // a spot in the road lane about 10.5 m from the puppy (the ladder cannot fold shorter than that), on the near side
    const p = r.group.getWorldPosition(V()), R = ROAD.r - 0.8, rp = Math.hypot(p.x, p.z), want = 10.5;
    const a = Math.atan2(p.z, p.x), c = (rp * rp + R * R - want * want) / (2 * rp * R);
    if (Math.abs(c) > 1) return V(Math.cos(a) * R, 0, Math.sin(a) * R);
    const d = Math.acos(c), c1 = V(Math.cos(a + d) * R, 0, Math.sin(a + d) * R), c2 = V(Math.cos(a - d) * R, 0, Math.sin(a - d) * R);
    return c1.distanceTo(truck.pos) < c2.distanceTo(truck.pos) ? c1 : c2;
  };

  // ---------------------------------------------------------------- markers: where the truck is going, and an alert icon over a fire
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.9, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd23a', transparent: true, opacity: 0.9, depthWrite: false }));
  marker.visible = false; marker.userData.t = 0; scene.add(marker);
  const iconMats = [];                            // dimmed at night so the white discs stay under the bloom threshold
  const icon = emoji => {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(128, 128, 110, 0, 7); g.fill(); g.strokeStyle = '#ff3b2f'; g.lineWidth = 16; g.stroke();
    g.font = '140px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(emoji, 128, 140);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.SpriteMaterial({ map: t, depthTest: false }); if (S.night) m.color.setScalar(0.5); iconMats.push(m);
    const s = new THREE.Sprite(m); s.scale.setScalar(2.6); s.renderOrder = 20; return s;
  };
  const dropIcon = ic => { scene.remove(ic); iconMats.splice(iconMats.indexOf(ic.material), 1); ic.material.map.dispose(); ic.material.dispose(); };
  const alerts = new Map();                       // fire -> sprite
  G.hydrantMarks = W.hydrants.map(h => { const s = icon('💧'); s.position.copy(h.position).add(V(0, 3.2, 0)); s.visible = false; scene.add(s); return s; });
  const rescueMarks = {};
  for (const k in rescues) { const s = icon(k === 'cat' ? '🐱' : '🐶'); s.visible = false; scene.add(s); rescueMarks[k] = s; }

  // ---------------------------------------------------------------- actions (the big buttons)
  G.actions = {
    lights: () => { S.lights = !S.lights; setBtn('lights', S.lights); if (S.lights) { sayOnce('lights_on'); emit('lights'); } A.pop(1.2); },
    siren: () => { const on = !A.sirenIsOn(); A.sirenOn(on); S.siren = on; setBtn('siren', on); if (on) { S.lights = true; setBtn('lights', true); sayOnce('siren_on'); emit('siren'); emit('lights'); } },
    horn: () => { A.horn(); emit('horn'); },
    bell: () => { S.bellT = S.t; A.bell(); setTimeout(() => A.bell(1.02), 260); emit('bell'); },
    tools: () => {
      const anyClosed = Object.keys(T.shutters).some(k => !S.shutters[k]);
      for (const k in T.shutters) S.shutters[k] = anyClosed;
      A.rattle(1.0); setBtn('tools', anyClosed); if (anyClosed) { sayOnce('shutter'); G.focusSide(); emit('tools'); }
    },
    doors: () => { const open = !Object.values(S.doors).some(v => v); for (const k in S.doors) S.doors[k] = open ? 1 : 0; A.clunk(); if (open) { sayOnce('door_open'); emit('door'); } setBtn('doors', open); },
    ladder: () => ladderButton(),
    outriggers: () => { if (Math.abs(truck.speed) > 0.3) return; S.outrig = S.outrig ? 0 : 1; A.whir(1.6, !!S.outrig); setBtn('outriggers', S.outrig); if (S.outrig) { sayOnce('outriggers'); emit('outriggers'); } },
    agent: () => { S.agent = S.agent === 'water' ? 'foam' : 'water'; say(S.agent === 'foam' ? 'foam_on' : 'water_on'); ui.setAgent(S.agent); A.pop(S.agent === 'foam' ? 0.7 : 1.3); if (S.agent === 'foam') emit('foam'); pulse('agent', false); },
    view: () => {
      G.camMode = { follow: 'cab', cab: 'free', free: 'follow' }[G.camMode];
      say({ follow: 'follow_view', cab: 'cab_view', free: 'free_view' }[G.camMode]); ui.setView(G.camMode); setCabView(G.camMode === 'cab');
    },
    fire: () => {
      let f = nearestFire(); if (!f) { G.startFire(); return; }
      driveTo(f.site.parkAt.clone(), true); say('drive'); if (!A.sirenIsOn()) G.actions.siren();
    },
  };

  // ---------------------------------------------------------------- taps on the 3D world
  G.handleTap = (tap, o, hit) => {
    if (tap === 'door') { const k = o.name.slice(5); S.doors[k] = S.doors[k] ? 0 : 1; A.clunk(); if (S.doors[k]) { sayOnce('door_open'); emit('door'); } return; }
    if (tap === 'shutter') { const k = o.name.replace('Shutter_', '').replace('_', ''); S.shutters[k] = !S.shutters[k]; A.rattle(0.9); if (S.shutters[k]) { sayOnce('shutter'); emit('tools'); } return; }
    if (tap.startsWith('tool:')) {
      const tl = T.tools.find(x => x.o === o); if (!tl) return;
      if (!S.shutters[tl.shutter]) { S.shutters[tl.shutter] = true; A.rattle(0.9); emit('tools'); return; }
      tl.t = S.t; A.pop(1.4); A.sparkle(); say('tool_' + tl.kind); ui.showLabel(TOOL_NAMES[tl.kind] || '工具', tl.o, 3.4); emit('tool', tl.kind); return;
    }
    if (tap === 'valve') {
      const v = T.valves.find(x => x.v === o); if (!v) return;
      v.t = 1; A.clunk(); G.squirts.push({ v, until: S.t + 2.6 }); sayOnce('valve'); A.waterOn(true, 0.6);
      setTimeout(() => { if (!S.spraying) A.waterOn(false); v.t = 0; }, 2600); emit('valve'); return;
    }
    if (tap === 'reel') { S.reelV += 9; A.whir(0.8); sayOnce('reel'); emit('reel'); return; }
    if (tap === 'bell') { G.actions.bell(); return; }
    if (tap === 'lights') { G.actions.lights(); return; }
    if (tap === 'wheel') { A.horn(0.35); say('wheel'); return; }
    if (tap === 'ladder') { ladderButton(); return; }
    if (tap === 'nozzle') { say('nozzle'); G.burstUntil = S.t + 2.5; return; }
    if (tap === 'outrigger') { G.actions.outriggers(); return; }
    if (tap === 'kid') { const k = o.name.includes('Jiawen') ? 'jiawen' : 'bowen'; T.kids[k].t = S.t; say('kid_' + k); A.pop(1.3); emit('kid'); return; }
    if (tap === 'hydrant') { hydrantTap(hit && hit.object.userData.hydrant || W.hydrants[0]); return; }
    if (tap === 'station') { say('station'); driveTo(START.apron.pos.clone()); return; }
    if (tap === 'car') {
      const f = hit && hit.object.userData.fire;
      if (f && f.active) { driveTo(f.site.parkAt.clone(), true); say('drive'); } else A.carHorn();
      return;
    }
    if (tap === 'cat' || tap === 'dog') {
      const r = rescues[tap]; r.sound();
      if (r.enabled && r.phase === 'idle') {
        say(r.ask);
        const spot = spotFor(r);
        if (truck.pos.distanceTo(spot) > 3) { driveTo(spot); truck.onArrive = () => setTimeout(ladderButton, 400); } else ladderButton();
      }
      return;
    }
    if (tap === 'house') {
      const house = o.userData.house; const f = G.fires.find(fi => fi.active && fi.site.house === house);
      if (f) { driveTo(f.site.parkAt.clone(), true); say('drive'); } else { A.pop(1); driveTo(house.parkAt.clone()); }
      return;
    }
  };

  // ---------------------------------------------------------------- driving
  function startDriving() {
    if (S.outrig || S.elevT > 0 || S.extT > 0) {
      if (rescues.cat.phase === 'riding' || rescues.dog.phase === 'riding') return;    // not while carrying a passenger
      stowLadder(T); S.outrig = 0; setBtn('outriggers', 0); setBtn('ladder', 0); A.whir(1.4, false);
    }
    if (G.hose) disconnectHose();
    for (const k in S.doors) S.doors[k] = 0;
    for (const k in S.shutters) S.shutters[k] = false; setBtn('tools', 0); setBtn('doors', 0);
    if (!G.engine) { G.engine = true; A.engineOn(true); }
    S.headlights = true;
  }
  G.startDriving = startDriving;
  // a route: straight there if that does not cross the park, otherwise onto the ring road, round it, and off again
  const PARK = ROAD.r - ROAD.w / 2 - 0.3;
  function segDistToOrigin(a, b) {
    const abx = b.x - a.x, abz = b.z - a.z, L2 = abx * abx + abz * abz || 1;
    const t = THREE.MathUtils.clamp(-(a.x * abx + a.z * abz) / L2, 0, 1);
    return Math.hypot(a.x + abx * t, a.z + abz * t);
  }
  function planRoute(from, to) {
    const sp = STATION.pos;                                   // inside the station: straight out of the door first
    if (Math.abs(from.x - sp.x) < 6 && from.z < sp.z + 6.5 && from.z > sp.z - 7) {
      const door = V(sp.x, 0, sp.z + 12);
      return [V(sp.x, 0, sp.z + 7.5), ...planRoute(door, to)];
    }
    if (segDistToOrigin(from, to) > PARK) return [to];
    const a0 = Math.atan2(from.z, from.x), a1 = Math.atan2(to.z, to.x);
    let da = a1 - a0; da = Math.atan2(Math.sin(da), Math.cos(da));
    const R = ROAD.r - 1.2, n = Math.max(1, Math.ceil(Math.abs(da) / 0.3)), pts = [];
    for (let i = 0; i <= n; i++) { const a = a0 + da * i / n; pts.push(V(Math.cos(a) * R, 0, Math.sin(a) * R)); }
    if (from.length() > R + 1 || from.length() < PARK) pts.shift();      // already near the road: skip the entry point
    pts.push(to);
    return pts.filter((q, i) => i === pts.length - 1 || q.distanceTo(from) > 3);
  }
  function driveTo(p, urgent = false) {
    const q = p.clone(); q.y = 0;
    if (q.length() > LIMIT - 3) q.setLength(LIMIT - 3);
    for (const o of W.obstacles) if (o.r) { const d = Math.hypot(q.x - o.x, q.z - o.z); if (d < o.r + 3) { const k = (o.r + 3) / Math.max(d, 0.01); q.x = o.x + (q.x - o.x) * k; q.z = o.z + (q.z - o.z) * k; } }
    truck.final = q; truck.route = planRoute(truck.pos, q); truck.target = truck.route.shift(); truck.urgent = urgent; truck.onArrive = null; truck.stuck = 0; truck.unstuckN = 0; truck.backing = 0;
    startDriving(); if (!urgent) A.pop(0.9);
    marker.position.copy(q).setY(0.06); marker.visible = true; marker.userData.t = 0;
  }
  G.driveTo = driveTo;
  const fwd = V();
  function updateDriving(dt) {
    let thr = truck.manual.thr, str = truck.manual.str;
    if (truck.target && thr === 0 && str === 0) {
      const dx = truck.target.x - truck.pos.x, dz = truck.target.z - truck.pos.z, dist = Math.hypot(dx, dz);
      let diff = Math.atan2(dx, dz) - truck.heading; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const waypoint = truck.route && truck.route.length > 0;
      if (truck.backing > 0) {                                   // unsticking: reverse, turned away
        truck.backing -= dt; thr = -0.7; str = -Math.sign(diff || 1);
        if (truck.backing <= 0) {
          truck.route = planRoute(truck.pos, truck.final);
          if ((truck.unstuckN = (truck.unstuckN || 0) + 1) > 1 && truck.route.length > 1) truck.route.shift();   // still stuck here: skip a waypoint
          truck.target = truck.route.shift();
        }
      } else if (dist < (waypoint ? 5.5 : 1.6)) {
        if (waypoint) truck.target = truck.route.shift();
        else { truck.target = null; marker.visible = false; thr = 0; arrived(); }
      } else {
        str = THREE.MathUtils.clamp(diff * 1.8, -1, 1);
        // steer round anything just ahead (trees, lamps, hydrants, cars)
        const fx = Math.sin(truck.heading), fz = Math.cos(truck.heading), lx = Math.cos(truck.heading), lz = -Math.sin(truck.heading);
        const nose = V(truck.pos.x + fx * 3, 0, truck.pos.z + fz * 3);
        for (const o of W.obstacles.concat(traffic.obstacles())) {
          if (!o.r) continue;
          const rx = o.x - nose.x, rz = o.z - nose.z, along = rx * fx + rz * fz, side = rx * lx + rz * lz;
          if (along > 0 && along < 7 && Math.abs(side) < o.r + 1.9 && Math.hypot(o.x - truck.target.x, o.z - truck.target.z) > o.r + 1.5)
            str = THREE.MathUtils.clamp(str - Math.sign(side || 1) * (1 - along / 7) * 1.6, -1, 1);
        }
        thr = THREE.MathUtils.clamp(dist / 5, 0.3, 1) * (Math.abs(diff) > 1.2 ? 0.45 : 1);
        if (waypoint) thr = Math.max(thr, 0.7);
        if (dist < 4 && Math.abs(diff) > 1.4) thr = -0.5;
        // stuck against something? back out and try again
        truck.stuck = Math.abs(truck.speed) < 0.5 ? (truck.stuck || 0) + dt : 0;
        if (truck.stuck > 1.2) { truck.stuck = 0; truck.backing = 1.1; }
      }
    }
    const maxV = truck.urgent ? 8.5 : 6.5;
    const want = thr * (thr >= 0 ? maxV : 3);
    const acc = Math.sign(want - truck.speed) === Math.sign(truck.speed) || truck.speed === 0 ? 3.2 : 7;
    S.braking = Math.abs(truck.speed) > 0.4 && Math.abs(want) < Math.abs(truck.speed) - 0.5;
    truck.speed += THREE.MathUtils.clamp(want - truck.speed, -acc * dt, acc * dt);
    if (Math.abs(truck.speed) < 0.02 && thr === 0) truck.speed = 0;
    truck.steer += (str * 0.55 - truck.steer) * Math.min(1, dt * 5);
    truck.heading += truck.speed * Math.tan(truck.steer) / 5.6 * dt;
    fwd.set(Math.sin(truck.heading), 0, Math.cos(truck.heading));
    truck.pos.addScaledVector(fwd, truck.speed * dt);
    collide();
    S.speed = truck.speed; S.steer = truck.steer;
    S.turn = Math.abs(truck.steer) > 0.12 && Math.abs(truck.speed) > 0.3 ? Math.sign(truck.steer) : 0;
    A.reverseBeep(truck.speed < -0.15);
    A.engineSpeed(Math.min(1, Math.abs(truck.speed) / 7));
    T.model.rotation.x = THREE.MathUtils.lerp(T.model.rotation.x, -(want - truck.speed) * 0.004, 0.1);
    T.model.rotation.z = THREE.MathUtils.lerp(T.model.rotation.z, -truck.steer * truck.speed * 0.006, 0.1);
    T.root.position.copy(truck.pos); T.root.rotation.y = truck.heading;
    if (G.engine && Math.random() < 0.3 + Math.abs(truck.speed) * 0.05) {
      const p = V(); T.exhaust.getWorldPosition(p);
      fx.exhaust.add(p, V(0, 1.2, 0).addScaledVector(fwd, -truck.speed * 0.3), 0.2, 1.1, 1.4);
    }
    if (Math.abs(truck.speed) < 0.01 && !truck.target && G.engine && S.t - (G.lastMove || 0) > 12) { G.engine = false; A.engineOn(false); if (!S.night) S.headlights = false; }
    if (Math.abs(truck.speed) > 0.05) G.lastMove = S.t;
  }
  const OFFS = [3.0, 0, -3.0];
  function collide() {
    const obs = W.obstacles.concat(traffic.obstacles(), G.carFire.site.car.visible ? [{ x: G.burntCar.position.x, z: G.burntCar.position.z, r: 1.9 }] : []);
    for (let it = 0; it < 2; it++) for (const oz of OFFS) {
      const cx = truck.pos.x + Math.sin(truck.heading) * oz, cz = truck.pos.z + Math.cos(truck.heading) * oz, R = 1.35;
      for (const o of obs) {
        if (o.r) {
          const dx = cx - o.x, dz = cz - o.z, d = Math.hypot(dx, dz), m = o.r + R;
          if (d < m) { const k = (m - d) / Math.max(d, 1e-3); truck.pos.x += dx * k; truck.pos.z += dz * k; truck.speed *= 0.6; }
        } else if (o.box) {
          const [x0, z0, x1, z1] = o.box, px = THREE.MathUtils.clamp(cx, x0, x1), pz = THREE.MathUtils.clamp(cz, z0, z1);
          const dx = cx - px, dz = cz - pz, d = Math.hypot(dx, dz);
          if (d < R) { const k = (R - d) / Math.max(d, 1e-3); truck.pos.x += dx * k; truck.pos.z += dz * k; truck.speed *= 0.6; }
        }
      }
      const r = Math.hypot(cx, cz); if (r > LIMIT) { truck.pos.x *= LIMIT / r; truck.pos.z *= LIMIT / r; truck.speed *= 0.5; }
    }
  }
  function arrived() {
    emit('arrived', truck.pos.clone());
    if (truck.onArrive) { const f = truck.onArrive; truck.onArrive = null; f(); return; }
    const f = nearestFire();
    if (f && f.pos.distanceTo(truck.pos) < 17 && !f.announced) { f.announced = true; say('fire_arrive'); pulse('spray', true); }
    else if (!f) say('park');
  }

  // ---------------------------------------------------------------- the ladder and the rescues
  function nearestFire(maxD = 1e9) {
    let best = null, bd = maxD;
    for (const f of G.fires) if (f.active) { const d = f.pos.distanceTo(truck.pos); if (d < bd) { bd = d; best = f; } }
    return best;
  }
  G.nearestFire = nearestFire;
  function ladderButton() {
    if (Math.abs(truck.speed) > 0.3 || truck.target) {
      truck.target = null; marker.visible = false; truck.manual.thr = 0;
      clearTimeout(G.ladderRetry); G.ladderRetry = setTimeout(ladderButton, 700); return;
    }
    for (const r of Object.values(rescues)) {
      if (!r.enabled || r.phase !== 'idle') continue;
      const p = r.group.getWorldPosition(V());
      if (p.distanceTo(truck.pos) < 15.5) {
        r.phase = 'reaching'; S.outrig = 1; setBtn('outriggers', 1); A.whir(1.6);
        r.aimed = false; setTimeout(() => { aimLadder(T, p.clone().add(V(0, 0.3, 0)), 'reach'); r.aimed = true; A.whir(2.4); }, 1200);
        say('ladder_up'); setBtn('ladder', 1); G.reaching = r; return;
      }
    }
    const up = !(S.elevT > 0 || S.extT > 0);
    if (up) { S.outrig = 1; setBtn('outriggers', 1); setTimeout(() => { S.elevT = 0.75; S.extT = 0.5; S.yawT = 0; A.whir(2.4); }, S.outrigT > 0.9 ? 0 : 1200); say('ladder_up'); emit('ladder'); }
    else { stowLadder(T); A.whir(2.2, false); say('ladder_down'); setTimeout(() => { if (!(S.elevT > 0)) { S.outrig = 0; setBtn('outriggers', 0); } }, 3500); }
    setBtn('ladder', up);
  }
  G.ladderButton = ladderButton;
  function updateRescues(dt) {
    for (const r of Object.values(rescues)) {
      rescueMarks[r.key].visible = r.enabled && r.phase === 'idle' && r.group.visible;
      if (rescueMarks[r.key].visible) rescueMarks[r.key].position.copy(r.group.getWorldPosition(V())).add(V(0, 1.6 + Math.sin(S.t * 3) * 0.15, 0));
      if (!r.group.visible) continue;
      if (r.phase === 'idle') {
        r.group.rotation.y = Math.sin(S.t * 1.3) * 0.4; r.group.position.y = r.home.y + Math.abs(Math.sin(S.t * 3)) * 0.04;
        if (r.enabled && Math.random() < dt * 0.15) r.sound();
        if (r.group.userData.tail) r.group.userData.tail.rotation.z = Math.sin(S.t * 14) * 0.6;
      }
      if (r.phase === 'reaching') {
        const tip = tipWorld(T, V()), cp = r.group.getWorldPosition(V());
        if (r.aimed && !ladderBusy(T) && tip.distanceTo(cp) < 2.6) {
          (T.ladder.seat || T.ladder.basket).attach(r.group); r.phase = 'riding'; r.sound(); A.sparkle();
          r.group.position.set(0, 0, 0); r.group.rotation.set(0, Math.PI, 0);
          setTimeout(() => { stowLadder(T); A.whir(2.4, false); }, 1200);
        } else if (r.aimed && !ladderBusy(T) && S.t > (r.retry || 0)) { r.retry = S.t + 2; aimLadder(T, cp.clone().add(V(0, 0.3, 0)), 'reach'); }
      }
      if (r.phase === 'riding' && !ladderBusy(T) && S.elevT === 0 && S.ext < 0.02) {
        scene.attach(r.group); r.phase = 'jump';
        const side = V(2.4, 0, -1).applyAxisAngle(V(0, 1, 0), truck.heading).add(truck.pos);
        r.jump = { from: r.group.position.clone(), to: side, t: 0 };
        S.outrig = 0; setBtn('outriggers', 0); setBtn('ladder', 0);
      }
      if (r.phase === 'jump') {
        const j = r.jump; j.t += dt; const k = Math.min(1, j.t / 0.9);
        r.group.position.lerpVectors(j.from, j.to, k); r.group.position.y = THREE.MathUtils.lerp(j.from.y, 0, k) + Math.sin(k * Math.PI) * 1.5;
        if (k >= 1) {
          r.phase = 'saved'; say(r.saved); r.sound(); fx.confetti.burst(r.group.position.clone().add(V(0, 1, 0)), 120); A.fanfare();
          T.kids.jiawen.t = S.t; T.kids.bowen.t = S.t + 0.2; emit(r.event, r.group.position.clone());
        }
      }
      if (r.phase === 'saved') { r.group.rotation.y += dt * 0.6; r.group.position.y = Math.abs(Math.sin(S.t * 4)) * 0.12; if (r.group.userData.tail) r.group.userData.tail.rotation.z = Math.sin(S.t * 18) * 0.7; }
    }
  }
  G.resetRescue = (key, enabled) => {
    const r = rescues[key]; r.enabled = enabled; r.phase = 'idle'; r.retry = 0;
    r.homeParent.attach(r.group); r.group.position.copy(r.home); r.group.rotation.set(0, 0, 0);
    r.group.visible = key === 'cat' ? true : enabled;
  };

  // ---------------------------------------------------------------- the tank, the hydrants and the hose
  const hoseMat = new THREE.MeshStandardMaterial({ color: '#c4271d', roughness: 0.6 });
  function connectHose(h) {
    const a = V(); T.valves[0].out.getWorldPosition(a);
    const b = h.position.clone().add(V(0, 0.62, 0.32));
    const mid = a.clone().lerp(b, 0.5); mid.y = 0.08;
    const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(mid, 0.4).setY(0.25), mid, b.clone().lerp(mid, 0.4).setY(0.2), b]);
    G.hose = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.06, 8, false), hoseMat); G.hose.castShadow = true; scene.add(G.hose);
    G.refilling = h; A.refillOn(true); say('refill_start'); A.clunk();
  }
  function disconnectHose() { if (G.hose) { scene.remove(G.hose); G.hose.geometry.dispose(); G.hose = null; } G.refilling = null; A.refillOn(false); }
  function hydrantTap(h) {
    if (Math.abs(truck.speed) < 0.3 && h.position.distanceTo(truck.pos) < 10.5 && !G.hose) { if (S.tank < 99) connectHose(h); else { say('hydrant'); G.hydrantFun = { h, until: S.t + 3.5 }; A.waterOn(true, 0.7); setTimeout(() => { if (!S.spraying) A.waterOn(false); }, 3500); } return; }
    if (S.tank > 98) { say('hydrant'); G.hydrantFun = { h, until: S.t + 3.5 }; A.waterOn(true, 0.7); setTimeout(() => { if (!S.spraying) A.waterOn(false); }, 3500); return; }
    // drive over, then connect
    // park in the road lane next to the hydrant
    const a = Math.atan2(h.position.z, h.position.x), r = h.position.length() < ROAD.r ? ROAD.r - 1.2 : ROAD.r + 1.6;
    driveTo(V(Math.cos(a) * r, 0, Math.sin(a) * r)); truck.onArrive = () => { if (h.position.distanceTo(truck.pos) < 10.5) connectHose(h); };
  }
  G.hydrantTap = hydrantTap;
  function updateTank(dt) {
    if (G.refilling) {
      S.tank = Math.min(100, S.tank + 22 * dt);
      if (S.tank >= 100) { disconnectHose(); say('refill_done'); A.sparkle(); emit('refilled'); G.said.water_low = 0; G.said.water_empty = 0; }
    }
    G.hydrantMarks.forEach(m => { m.visible = S.tank < 25 && !G.refilling; m.position.y = 3.2 + Math.sin(S.t * 3) * 0.2; });
    ui.setTank(S.tank);
  }

  // ---------------------------------------------------------------- water and foam
  const nPos = V(), nDir = V();
  function updateWater(dt) {
    const f = nearestFire(19);
    const burst = G.burstUntil && S.t < G.burstUntil;
    const wantSpray = G.spray || burst;
    const busyRescue = rescues.cat.phase === 'reaching' || rescues.dog.phase === 'reaching' || rescues.cat.phase === 'riding' || rescues.dog.phase === 'riding';
    if (wantSpray && Math.abs(truck.speed) < 0.3 && !busyRescue) {
      if (f) {
        if (!S.outrig) { S.outrig = 1; setBtn('outriggers', 1); A.whir(1.6); }
        if (S.outrigT > 0.95) aimLadder(T, f.pos.clone().add(V(0, 1.3, 0)), 'spray');
        setBtn('ladder', 1); pulse('spray', false);
      } else if (!(S.elevT > 0)) { S.outrig = 1; setBtn('outriggers', 1); if (S.outrigT > 0.95) { S.elevT = 0.55; S.extT = 0.25; S.nozPitchT = 0.35; } }
    }
    S.aimDir = null;
    const speed = S.agent === 'foam' ? 13 : 15.5;
    if (f && wantSpray && S.elev > 0.08) {
      nozzleWorld(T, nPos, nDir);
      const Q = f.pos.clone().add(V(0, 0.9, 0)), dx = Q.x - nPos.x, dz = Q.z - nPos.z, d = Math.hypot(dx, dz), dy = Q.y - nPos.y;
      const v = speed, g = 9.8, disc = v ** 4 - g * (g * d * d + 2 * dy * v * v);
      const th = disc > 0 ? Math.atan((v * v - Math.sqrt(disc)) / (g * Math.max(d, 0.5))) : Math.PI / 4;
      S.aimDir = V(dx / d * Math.cos(th), Math.sin(th), dz / d * Math.cos(th));
    }
    const ready = S.elev > 0.08 && (!ladderBusy(T) || burst);
    const hasWater = S.tank > 0;
    if (wantSpray && ready && !hasWater && !G.said.water_empty) { G.said.water_empty = 1; say('water_empty'); }
    const spraying = wantSpray && ready && hasWater;
    if (spraying !== S.spraying) { S.spraying = spraying; A.waterOn(spraying, S.agent === 'foam' ? 0.7 : 1); if (spraying) sayOnce('spray'); }
    const colliders = G.fires.map(fi => ({ active: fi.active, pos: fi.pos.clone().add(V(0, 1.2, 0)), r: 2.2, fire: fi }));
    const P = fx[S.agent === 'foam' ? 'foam' : 'water'];
    nozzleWorld(T, nPos, nDir);
    (S.agent === 'foam' ? fx.foamJet : fx.jet).update(dt, spraying, nPos, nDir, speed, colliders);
    (S.agent === 'foam' ? fx.jet : fx.foamJet).update(dt, false);
    if (spraying) {
      P.emit(nPos, nDir, S.agent === 'foam' ? 120 : 160, dt, speed, S.agent === 'foam' ? 0.09 : 0.05);
      S.tank = Math.max(0, S.tank - (S.agent === 'foam' ? 6 : 4.5) * dt * (burst && !G.spray ? 0 : 1));
      if (S.tank < 25 && !G.said.water_low) { G.said.water_low = 1; say('water_low'); }
      if (S.tank <= 0) { say('water_empty'); G.said.water_empty = 1; }
    }
    // pump-panel squirts and the hydrant fountain (just for fun, they do not use the tank)
    for (const sq of G.squirts) if (S.t < sq.until) {
      sq.v.out.getWorldPosition(nPos); const q = new THREE.Quaternion(); sq.v.out.getWorldQuaternion(q);
      nDir.set(-1, 0.25, 0).applyQuaternion(q).normalize(); fx.water.emit(nPos, nDir, 90, dt, 5, 0.12);
    }
    G.squirts = G.squirts.filter(s => S.t < s.until);
    if (G.hydrantFun && S.t < G.hydrantFun.until) { nPos.copy(G.hydrantFun.h.position).setY(1.25); nDir.set(0, 1, 0); fx.water.emit(nPos, nDir, 120, dt, 7.5, 0.35); }
    fx.water.update(dt, colliders); fx.foam.update(dt, colliders);
    for (const [sys, agent] of [[fx.water, 'water'], [fx.foam, 'foam']]) for (const h of sys.hits) if (h.fire && h.fire.douse(agent === 'foam' ? 0.0022 : 0.0016, fx.steam, agent)) extinguished(h.fire);
    for (const fi of G.fires) if (fi.oil && fi.active && (fi.wrongAgent || 0) > 30 && !G.said.need_foam) { G.said.need_foam = 1; say('need_foam'); pulse('agent', true); }
    if (f && f.hp < 0.5 && !f.halfSaid) { f.halfSaid = true; say('fire_half'); }
  }
  function extinguished(f) {
    if (f.site.house) {
      const h = f.site.house; h.burning = G.fires.some(o => o !== f && o.active && o.site.house === h);
      if (!h.burning) h.windows.forEach(w => { w.material.emissive.set(W.night ? '#ffc56a' : '#18323f'); w.material.emissiveIntensity = W.night ? 0.9 : 0.25; });
      scorches.push(scorch(scene, f.pos.clone().add(V(0, -0.6, 0)), f.site.normal, 2.0));
    }
    const ic = alerts.get(f); if (ic) { dropIcon(ic); alerts.delete(f); }
    if (!G.fires.some(o => o.active)) { pulse('fire', false); pulse('spray', false); }
    fx.confetti.burst(f.pos.clone().add(V(0, 2, 0)), 260);
    A.fanfare(); say('fire_out'); T.kids.jiawen.t = S.t + 0.3; T.kids.bowen.t = S.t + 0.5;
    emit('fireOut', f);
    if (G.freeFires) G.nextFireAt = S.t + 60;
  }
  G.startFire = (which, { quiet = false } = {}) => {
    let f = typeof which === 'object' ? which : null;
    if (!f) {
      const free = G.fires.filter(x => !x.active && x.site.kind === 'house' && x !== G.fireH0b);
      f = typeof which === 'number' ? G.fires[which] : free[Math.floor(Math.random() * free.length)];
    }
    if (!f) return null;
    f.start(); f.announced = false; f.halfSaid = false; f.wrongAgent = 0;
    if (f.site.house) { f.site.house.burning = true; (f.site.window ? [f.site.window] : f.site.house.windows).forEach(w => { w.material.emissive.set('#ff6a1a'); w.material.emissiveIntensity = 1.4; }); }
    if (f.site.car) f.site.car.visible = true;
    const ic = icon('🔥'); ic.position.copy(f.pos).add(V(0, 5.2, 0)); scene.add(ic); alerts.set(f, ic);
    if (!quiet) { say('fire_alarm'); setTimeout(() => say('fire_go', { queue: true }), 200); A.bell(1.3); setTimeout(() => A.bell(1.3), 300); setTimeout(() => A.bell(1.3), 600); }
    pulse('fire', true);
    return f;
  };

  // ---------------------------------------------------------------- camera
  const camGoal = V(); let focusUntil = 0;
  G.focusSide = () => { focusUntil = performance.now() / 1000 + 2.5; };
  function setCabView(on) {
    T.kids.jiawen.root.visible = !on;
    controls.enabled = !on;
    camera.fov = on ? 72 : (innerWidth / innerHeight < 1 ? 58 : 42); camera.updateProjectionMatrix();
  }
  G.setCabView = setCabView;
  function blocked(p) {
    const sp = STATION.pos;
    if (Math.abs(p.x - sp.x) < 8.5 && Math.abs(p.z - sp.z) < 7.5) return true;
    for (const o of W.obstacles) if (o.r) {
      const d = Math.hypot(p.x - o.x, p.z - o.z);
      if (o.r > 2 && d < o.r + 1.5) return true;
      if (o.r <= 2 && p.y < 9 && d < o.r + 3.0) return true;
    }
    return Math.hypot(p.x, p.z) > LIMIT + 6;
  }
  function updateCamera(dt) {
    const now = performance.now() / 1000;
    if (G.camMode === 'cab') {
      const head = V(0.55, 2.25, 3.05).applyMatrix4(T.root.matrixWorld);
      const look = V(0.4 + truck.steer * 3, 1.6, 14).applyMatrix4(T.root.matrixWorld);
      camera.position.lerp(head, 1 - Math.exp(-14 * dt)); camera.lookAt(look);
      sunFollow(truck.pos); return;
    }
    const center = truck.pos.clone().add(V(0, 1.8, 0));
    const f = nearestFire(19);
    const fighting = f && (S.spraying || G.spray);
    let focusP = null;
    if (fighting) focusP = f.pos.clone().setY(3);
    for (const r of Object.values(rescues)) if (['reaching', 'riding', 'jump'].includes(r.phase)) focusP = r.group.getWorldPosition(V());
    if (G.refilling) focusP = G.refilling.position.clone().setY(1);
    const auto = G.camMode === 'follow' && now > G.userOrbitUntil;
    if (focusP) {
      center.lerp(focusP, 0.5);
      if (auto) {
        const span = Math.hypot(focusP.x - truck.pos.x, focusP.z - truck.pos.z);
        const perp = V(-(focusP.z - truck.pos.z), 0, focusP.x - truck.pos.x).normalize();
        if (perp.lengthSq() < 0.01) perp.set(1, 0, 0);
        if (perp.dot(camera.position.clone().sub(center)) < 0) perp.negate();
        const dist = Math.max(16, span * 1.5), hgt = 6.5 + span * 0.25;
        for (const [side, lift] of [[1, 0], [-1, 0], [1, 4], [-1, 4], [1, 9]]) { camGoal.copy(center).addScaledVector(perp, side * dist).setY(hgt + lift); if (!blocked(camGoal)) break; }
        camera.position.lerp(camGoal, 1 - Math.exp(-1.6 * dt));
      }
    }
    if (S.elev > 0.08 && !fighting) { const tip = tipWorld(T, V()); center.lerp(tip, 0.4); }
    controls.target.lerp(center, 1 - Math.exp(-4 * dt));
    const need = (S.elev > 0.08 || S.spraying) ? 21 + S.ext * 6 : 0;
    if (need && auto && !focusP) {
      const off = camera.position.clone().sub(controls.target), d = off.length();
      if (d < need) camera.position.copy(controls.target).addScaledVector(off.normalize(), d + (need - d) * (1 - Math.exp(-2 * dt)));
    }
    const moving = Math.abs(truck.speed) > 0.5;
    if (moving && auto && !focusP) {
      const back = 15;
      for (const a of [Math.PI - 0.25, Math.PI + 0.25, Math.PI - 0.8, Math.PI + 0.8, Math.PI / 2, -Math.PI / 2, 0.6, -0.6]) {
        const h = truck.heading + a; camGoal.set(truck.pos.x + Math.sin(h) * back, 7.5, truck.pos.z + Math.cos(h) * back);
        if (!blocked(camGoal)) break;
      }
      camera.position.lerp(camGoal, 1 - Math.exp(-2.2 * dt));
    }
    const sp = STATION.pos;
    if (Math.abs(camera.position.x - sp.x) < 8.5 && camera.position.z > sp.z - 7.5 && camera.position.z < sp.z + 7.5) camera.position.y = Math.max(camera.position.y, 10.5);
    camera.position.y = Math.max(camera.position.y, 1.2);
    if (now < focusUntil && auto) {
      const sideV = V(Math.cos(truck.heading), 0, -Math.sin(truck.heading));
      camGoal.copy(truck.pos).addScaledVector(sideV, 10).add(V(0, 3.5, 0));
      camera.position.lerp(camGoal, 1 - Math.exp(-2.5 * dt));
    }
    controls.update();
    sunFollow(controls.target);
  }
  function sunFollow(p) { lights.sun.target.position.copy(p); lights.sun.position.copy(p).add(lights.sunOffset); }

  // ---------------------------------------------------------------- day and night
  G.setNight = on => {
    W.setNight(on); S.night = on;
    lights.hemi.intensity = on ? 0.32 : 1.25; lights.hemi.color.set(on ? '#7f9bd6' : '#dff1ff'); lights.hemi.groundColor.set(on ? '#1d2a3a' : '#7a9a5a');
    lights.sun.intensity = on ? 0.55 : 2.6; lights.sun.color.set(on ? '#9fb8ff' : '#fff4e0');
    scene.fog.color.set(on ? '#0c1426' : '#d9eefc'); scene.environmentIntensity = on ? 0.18 : 0.55;
    if (on) { S.headlights = true; }
    for (const m of iconMats) m.color.setScalar(on ? 0.5 : 1);
  };

  // ---------------------------------------------------------------- reset for a level
  G.reset = ({ start = 'apron', tank = 100, traffic: trafficOn = true, night = false, cat = true, dog = false, freeFires = false } = {}) => {
    for (const f of G.fires) { f.active = false; f.hp = 0; f.group.visible = false; if (f.site.house) f.site.house.burning = false; }
    for (const ic of alerts.values()) dropIcon(ic); alerts.clear();
    for (const sc of scorches) scene.remove(sc); scorches.length = 0;
    G.carFire.site.car.visible = false;
    G.setNight(night);
    for (const h of W.houses) h.windows.forEach(w => { w.material.emissive.set(night ? '#ffc56a' : '#18323f'); w.material.emissiveIntensity = night ? 0.9 : 0.25; });
    const st = START[start] || START.apron;
    truck.pos.copy(st.pos); truck.heading = st.heading; truck.speed = 0; truck.steer = 0; truck.target = null; truck.manual.thr = truck.manual.str = 0; truck.onArrive = null;
    T.root.position.copy(truck.pos); T.root.rotation.y = truck.heading;
    stowLadder(T); S.yaw = S.elev = S.ext = 0; S.outrig = S.outrigT = 0;
    for (const k in S.doors) { S.doors[k] = 0; S.doorT[k] = 0; } for (const k in S.shutters) { S.shutters[k] = false; S.shutterT[k] = 0; }
    S.lights = false; S.siren = false; A.sirenOn(false); S.tank = tank; S.agent = 'water'; ui.setAgent('water'); S.spraying = false; A.waterOn(false); A.reverseBeep(false);
    disconnectHose(); marker.visible = false;
    G.resetRescue('cat', cat); G.resetRescue('dog', dog);
    traffic.setEnabled(trafficOn);
    G.flags = {}; G.said = {}; G.spray = false; G.freeFires = freeFires; G.nextFireAt = freeFires ? S.t + 40 : 1e9;
    ['lights', 'siren', 'tools', 'doors', 'ladder', 'outriggers'].forEach(b => setBtn(b, 0)); ['fire', 'spray', 'agent'].forEach(b => pulse(b, false));
    G.camMode = 'follow'; ui.setView('follow'); setCabView(false); G.userOrbitUntil = 0;
    const camOff = start === 'inside' ? V(-7, 9, 26) : V(-11, 6.5, 13.5);
    camera.position.copy(truck.pos).add(camOff.applyAxisAngle(V(0, 1, 0), truck.heading)); controls.target.copy(truck.pos).setY(1.8);
  };

  // ---------------------------------------------------------------- per frame
  G.update = dt => {
    G.t += dt;
    updateDriving(dt);
    animateTruck(T, dt);
    updateTank(dt);
    updateWater(dt);
    updateRescues(dt);
    for (const fi of G.fires) { fi.update(dt, camera, fx.smoke, fx.embers, fx.steam); if (fi.active) A.crackle(fi.hp * Math.max(0, 1 - fi.pos.distanceTo(camera.position) / 40)); }
    for (const [f, ic] of alerts) ic.position.y = f.pos.y + 5.2 + Math.sin(S.t * 3) * 0.3;
    if (G.freeFires && !G.fires.some(f => f.active) && S.t > G.nextFireAt && !truck.target && Math.abs(truck.speed) < 0.1) { G.startFire(); G.nextFireAt = 1e9; }
    const blockers = G.carFire.site.car.visible ? [{ x: G.burntCar.position.x, z: G.burntCar.position.z, r: 1.5 }] : [];
    if (traffic.update(dt, G.t, truck, S.siren, blockers) && !G.said.cars_yield) { G.said.cars_yield = 1; setTimeout(() => say('cars_yield', { queue: true }), 600); }
    const near = truck.pos.distanceTo(STATION.pos) < 15 ? 1 : 0, d = W.stationDoor;
    d.userData.open += (near - d.userData.open) * Math.min(1, dt * 1.5); d.scale.y = 1 - 0.93 * d.userData.open;
    if (marker.visible) { marker.userData.t += dt; marker.material.opacity = 0.6 + 0.3 * Math.sin(marker.userData.t * 8); marker.scale.setScalar(1 + 0.1 * Math.sin(marker.userData.t * 8)); }
    updateCamera(dt);
  };
  return G;
}
