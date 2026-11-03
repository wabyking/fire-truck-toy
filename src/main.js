// 佳文和博文的消防车 — an interactive fire truck toy for 3–5-year-olds.
// Tap the truck (doors, shutters, tools, valves, bell, reel, lights, kids), press the big buttons (lights, siren, horn,
// bell, toolbox, ladder, outriggers, water, fire mission), tap the ground to drive there, put out fires, rescue the kitten.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadTruck, animateTruck, nozzleWorld, tipWorld, aimLadder, stowLadder, ladderBusy } from './truck.js';
import { buildWorld, STATION, LIMIT } from './world.js';
import { makeFx, Fire } from './fx.js';
import * as A from './audio.js';
import { VOICE_TEXT } from './assets.js';

// ---------------------------------------------------------------- renderer, scene, camera
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let PR = Math.min(window.devicePixelRatio, 2), PR_MAX = PR;
renderer.setPixelRatio(PR);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#d9eefc', 70, 190);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 900);
camera.position.set(-11, 6.5, -6);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 7; controls.maxDistance = 48;
controls.maxPolarAngle = 1.42; controls.enablePan = false; controls.rotateSpeed = 0.7; controls.zoomSpeed = 0.8;

const hemi = new THREE.HemisphereLight('#dff1ff', '#7a9a5a', 1.25); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff4e0', 2.6); sun.position.set(-18, 30, 14); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -22; sun.shadow.camera.right = 22; sun.shadow.camera.top = 22; sun.shadow.camera.bottom = -22;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 90; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  camera.fov = w / h < 1 ? 58 : 42; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

// ---------------------------------------------------------------- world, truck, effects
const W = buildWorld(scene);
const fx = makeFx(scene);
for (const p of [...fx.puffs, fx.water.mist]) p.cam = camera;
let T = null;
const truck = { pos: new THREE.Vector3(0, 0, STATION.pos.z + 10.5), heading: 0, speed: 0, steer: 0, target: null, manual: { thr: 0, str: 0 } };
const fires = W.houses.map(h => new Fire(scene, h.fireWorld, 1.3));
const game = { stars: 0, mission: null, nextFireAt: 40, arrived: false, halfSaid: false, catPhase: 'tree', said: {}, mode: 'orbit', userOrbitUntil: 0, started: false, spray: false, squirts: [] };

// ---------------------------------------------------------------- UI
const $ = s => document.querySelector(s);
const toastEl = $('#toast'), starsEl = $('#stars'), labelEl = $('#label');
let toastTimer = 0;
function say(id, opt) {
  const d = A.say(id, opt);
  const text = VOICE_TEXT[id]; if (text) { toastEl.textContent = text; toastEl.classList.add('show'); toastTimer = Math.max(2.2, (d || 2) + 0.6); }
}
function sayOnce(id) { if (!game.said[id]) { game.said[id] = 1; say(id); return true; } return false; }
function setBtn(id, on) { const b = document.querySelector(`[data-act="${id}"]`); if (b) b.classList.toggle('on', !!on); }
function addStar(fromWorld) {
  game.stars++;
  const fly = document.createElement('div'); fly.className = 'flystar'; fly.textContent = '⭐';
  const p = fromWorld ? toScreen(fromWorld) : { x: innerWidth / 2, y: innerHeight / 2 };
  fly.style.left = p.x + 'px'; fly.style.top = p.y + 'px'; document.body.appendChild(fly);
  requestAnimationFrame(() => { const r = starsEl.getBoundingClientRect(); fly.style.left = r.left + 20 + 'px'; fly.style.top = r.top + 10 + 'px'; fly.style.transform = 'scale(0.6)'; });
  setTimeout(() => { fly.remove(); starsEl.querySelector('b').textContent = game.stars; starsEl.classList.add('bump'); setTimeout(() => starsEl.classList.remove('bump'), 400); A.sparkle(); }, 1100);
}
function toScreen(v) { const p = v.clone().project(camera); return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight, z: p.z }; }
let label = null;
function showLabel(text, obj, secs = 3) { label = { obj, until: performance.now() / 1000 + secs }; labelEl.textContent = text; labelEl.classList.add('show'); }

// big buttons
const ACTIONS = {
  lights: () => { T.state.lights = !T.state.lights; setBtn('lights', T.state.lights); if (T.state.lights) sayOnce('lights_on'); A.pop(1.2); },
  siren: () => { const on = !A.sirenIsOn(); A.sirenOn(on); T.state.siren = on; setBtn('siren', on); if (on) { T.state.lights = true; setBtn('lights', true); sayOnce('siren_on'); } },
  horn: () => { A.horn(); },
  bell: () => { T.state.bellT = T.state.t; A.bell(); setTimeout(() => A.bell(1.02), 260); },
  tools: () => {
    const anyClosed = Object.keys(T.shutters).some(k => !T.state.shutters[k]);
    for (const k in T.shutters) T.state.shutters[k] = anyClosed;
    A.rattle(1.0); setBtn('tools', anyClosed); if (anyClosed) { sayOnce('shutter'); focusCamera('side'); }
  },
  ladder: () => ladderButton(),
  outriggers: () => { if (Math.abs(truck.speed) > 0.3) return; T.state.outrig = T.state.outrig ? 0 : 1; A.whir(1.6, !!T.state.outrig); setBtn('outriggers', T.state.outrig); if (T.state.outrig) sayOnce('outriggers'); },
  fire: () => fireButton(),
  camera: () => { game.mode = game.mode === 'orbit' ? 'chase' : 'orbit'; setBtn('camera', game.mode === 'chase'); },
  doors: () => { const open = !Object.values(T.state.doors).some(v => v); for (const k in T.state.doors) T.state.doors[k] = open ? 1 : 0; A.clunk(); if (open) sayOnce('door_open'); setBtn('doors', open); },
};
for (const b of document.querySelectorAll('[data-act]')) {
  const act = b.dataset.act;
  if (act === 'spray') {
    const on = e => { e.preventDefault(); A.unlock(); game.spray = true; b.classList.add('on'); };
    const off = e => { game.spray = false; b.classList.remove('on'); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
  } else {
    b.addEventListener('pointerdown', e => { e.preventDefault(); A.unlock(); b.classList.add('press'); setTimeout(() => b.classList.remove('press'), 180); ACTIONS[act] && ACTIONS[act](); });
  }
}
// the driving pad
for (const b of document.querySelectorAll('[data-pad]')) {
  const d = b.dataset.pad;
  const on = e => { e.preventDefault(); A.unlock(); truck.target = null; if (d === 'up') truck.manual.thr = 1; if (d === 'down') truck.manual.thr = -1; if (d === 'left') truck.manual.str = 1; if (d === 'right') truck.manual.str = -1; b.classList.add('on'); startDriving(); };
  const off = () => { if (d === 'up' || d === 'down') truck.manual.thr = 0; else truck.manual.str = 0; b.classList.remove('on'); };
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
}
// keyboard (for grown-ups)
const keys = {};
window.addEventListener('keydown', e => {
  if (keys[e.code]) return; keys[e.code] = 1; A.unlock();
  const k = e.code;
  if (k === 'ArrowUp' || k === 'KeyW') { truck.manual.thr = 1; truck.target = null; startDriving(); }
  if (k === 'ArrowDown' || k === 'KeyS') { truck.manual.thr = -1; truck.target = null; startDriving(); }
  if (k === 'ArrowLeft' || k === 'KeyA') { truck.manual.str = 1; truck.target = null; }
  if (k === 'ArrowRight' || k === 'KeyD') { truck.manual.str = -1; truck.target = null; }
  if (k === 'Space') game.spray = true;
  if (k === 'KeyL') ACTIONS.lights(); if (k === 'KeyH') ACTIONS.horn(); if (k === 'KeyB') ACTIONS.bell(); if (k === 'KeyN') ACTIONS.siren();
  if (k === 'KeyT') ACTIONS.tools(); if (k === 'KeyU') ACTIONS.ladder(); if (k === 'KeyO') ACTIONS.outriggers(); if (k === 'KeyF') ACTIONS.fire(); if (k === 'KeyC') ACTIONS.camera();
});
window.addEventListener('keyup', e => {
  keys[e.code] = 0; const k = e.code;
  if (['ArrowUp', 'KeyW', 'ArrowDown', 'KeyS'].includes(k)) truck.manual.thr = 0;
  if (['ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD'].includes(k)) truck.manual.str = 0;
  if (k === 'Space') game.spray = false;
});
$('#mute').addEventListener('click', () => { A.unlock(); const m = $('#mute'); m.classList.toggle('off'); A.setMuted && A.setMuted(m.classList.contains('off')); });
$('#full').addEventListener('click', () => {
  const d = document.documentElement, fs = document.fullscreenElement || document.webkitFullscreenElement;
  if (!fs) (d.requestFullscreen || d.webkitRequestFullscreen || (() => {})).call(d);
  else (document.exitFullscreen || document.webkitExitFullscreen).call(document);
});

// ---------------------------------------------------------------- tapping the 3D world
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let down = null;
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; game.userOrbitUntil = performance.now() / 1000 + 3; A.unlock(); });
canvas.addEventListener('pointerup', e => {
  if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t; down = null;
  if (moved > 10 || dt > 600) return;
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects([...T.tappables, ...W.tappables, W.ground], false);
  for (const h of hits) {
    if (h.object.material && h.object.material.name === 'Glass') continue;    // look through the windows
    let o = h.object, tap = null; while (o && !tap) { tap = o.userData && o.userData.tap; if (!tap) o = o.parent; }
    if (h.object === W.ground) { driveTo(h.point); return; }
    if (tap) { handleTap(tap, o, h); return; }
    if (T.tappables.includes(h.object)) { A.pop(0.8); return; }     // some other part of the truck
  }
});

function handleTap(tap, o, hit) {
  const S = T.state;
  if (tap === 'door') { const k = o.name.slice(5); S.doors[k] = S.doors[k] ? 0 : 1; A.clunk(); if (S.doors[k]) sayOnce('door_open'); return; }
  if (tap === 'shutter') { const k = o.name.replace('Shutter_', '').replace('_', ''); S.shutters[k] = !S.shutters[k]; A.rattle(0.9); if (S.shutters[k]) sayOnce('shutter'); return; }
  if (tap.startsWith('tool:')) {
    const tl = T.tools.find(x => x.o === o); if (!tl) return;
    if (!S.shutters[tl.shutter]) { S.shutters[tl.shutter] = true; A.rattle(0.9); return; }
    tl.t = S.t; A.pop(1.4); A.sparkle(); say('tool_' + tl.kind);
    showLabel(TOOL_NAMES[tl.kind] || '工具', tl.o, 3.4); return;
  }
  if (tap === 'valve') {
    const v = T.valves.find(x => x.v === o); if (!v) return;
    v.t = v.t > 0 ? 0 : 1; A.clunk();
    if (v.t) { game.squirts.push({ v, until: S.t + 2.6 }); sayOnce('valve'); A.waterOn(true, 0.6); setTimeout(() => { if (!game.spray) A.waterOn(false); v.t = 0; }, 2600); }
    return;
  }
  if (tap === 'reel') { S.reelV += 9; A.whir(0.8); sayOnce('reel'); return; }
  if (tap === 'bell') { ACTIONS.bell(); return; }
  if (tap === 'lights') { ACTIONS.lights(); return; }
  if (tap === 'wheel') { A.horn(0.35); say('wheel'); return; }
  if (tap === 'ladder') { ladderButton(); return; }
  if (tap === 'nozzle') { say('nozzle'); game.burstUntil = S.t + 2.5; return; }
  if (tap === 'outrigger') { ACTIONS.outriggers(); return; }
  if (tap === 'kid') { const k = o.name.includes('Jiawen') ? 'jiawen' : 'bowen'; T.kids[k].t = S.t; say('kid_' + k); A.pop(1.3); return; }
  if (tap === 'hydrant') { say('hydrant'); game.hydrantUntil = S.t + 3.5; A.waterOn(true, 0.7); setTimeout(() => { if (!game.spray) A.waterOn(false); }, 3500); return; }
  if (tap === 'station') { say('station'); driveTo(STATION.pos.clone().add(new THREE.Vector3(0, 0, 10.5))); return; }
  if (tap === 'cat') {
    A.meow();
    if (game.catPhase === 'tree') {
      say('cat');
      const tree = W.cat.tree.position, away = truck.pos.clone().sub(tree).setY(0).normalize();
      const spot = tree.clone().addScaledVector(away, 7.5);
      if (truck.pos.distanceTo(spot) > 3) { driveTo(spot); game.catPending = true; } else ladderButton();
    }
    return;
  }
  if (tap === 'house') {
    const house = o.userData.house; const f = fires[W.houses.indexOf(house)];
    if (f && f.active) { driveTo(house.parkAt.clone(), true); say('drive'); }
    else { A.pop(1); driveTo(house.parkAt.clone()); }
    return;
  }
}
const TOOL_NAMES = { extinguisher: '灭火器', hose: '水带', helmet: '头盔', axe: '消防斧', cone: '路锥', firstaid: '急救箱', flashlight: '手电筒', boots: '消防靴', rope: '安全绳', pole: '消防钩' };

// ---------------------------------------------------------------- driving
function startDriving() {
  const S = T.state;
  if (S.outrig || S.elevT > 0 || S.extT > 0) { stowLadder(T); S.outrig = 0; setBtn('outriggers', 0); setBtn('ladder', 0); A.whir(1.4, false); }
  for (const k in S.doors) S.doors[k] = 0;
  for (const k in S.shutters) S.shutters[k] = false; setBtn('tools', 0); setBtn('doors', 0);
  if (!game.engine) { game.engine = true; A.engineOn(true); }
  S.headlights = true;
}
function driveTo(p, urgent = false) {
  // keep the target inside the town and outside obstacles
  const q = p.clone(); q.y = 0;
  if (q.length() > LIMIT - 3) q.setLength(LIMIT - 3);
  for (const o of W.obstacles) if (o.r) { const d = Math.hypot(q.x - o.x, q.z - o.z); if (d < o.r + 3) { const k = (o.r + 3) / Math.max(d, 0.01); q.x = o.x + (q.x - o.x) * k; q.z = o.z + (q.z - o.z) * k; } }
  truck.target = q; truck.urgent = urgent;
  startDriving(); if (!game.said.drive_hint) { game.said.drive_hint = 1; } else if (!urgent) A.pop(0.9);
  showMarker(q);
}
const marker = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.9, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd23a', transparent: true, opacity: 0.9, depthWrite: false }));
marker.visible = false; scene.add(marker);
function showMarker(p) { marker.position.copy(p).setY(0.06); marker.visible = true; marker.userData.t = 0; }

const fwd = new THREE.Vector3();
function updateDriving(dt) {
  const S = T.state;
  let thr = truck.manual.thr, str = truck.manual.str;
  if (truck.target && thr === 0 && str === 0) {
    const dx = truck.target.x - truck.pos.x, dz = truck.target.z - truck.pos.z, dist = Math.hypot(dx, dz);
    let diff = Math.atan2(dx, dz) - truck.heading; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    if (dist < 1.6) { truck.target = null; marker.visible = false; thr = 0; arrived(); }
    else {
      str = THREE.MathUtils.clamp(diff * 1.8, -1, 1);
      thr = THREE.MathUtils.clamp(dist / 5, 0.3, 1) * (Math.abs(diff) > 1.2 ? 0.45 : 1);
      if (dist < 4 && Math.abs(diff) > 1.4) thr = -0.5;                     // back up to turn around
    }
  }
  const maxV = truck.urgent ? 8.5 : 6.5;
  const want = thr * (thr >= 0 ? maxV : 3);
  const acc = Math.sign(want - truck.speed) === Math.sign(truck.speed) || truck.speed === 0 ? 3.2 : 7;
  truck.speed += THREE.MathUtils.clamp(want - truck.speed, -acc * dt, acc * dt);
  if (Math.abs(truck.speed) < 0.02 && thr === 0) truck.speed = 0;
  truck.steer += (str * 0.55 - truck.steer) * Math.min(1, dt * 5);
  truck.heading += truck.speed * Math.tan(truck.steer) / 5.6 * dt;
  fwd.set(Math.sin(truck.heading), 0, Math.cos(truck.heading));
  truck.pos.addScaledVector(fwd, truck.speed * dt);
  collide();
  S.speed = truck.speed; S.steer = truck.steer;
  A.engineSpeed(Math.min(1, Math.abs(truck.speed) / 7));
  // a little body pitch and roll
  T.model.rotation.x = THREE.MathUtils.lerp(T.model.rotation.x, -(want - truck.speed) * 0.004, 0.1);
  T.model.rotation.z = THREE.MathUtils.lerp(T.model.rotation.z, -truck.steer * truck.speed * 0.006, 0.1);
  T.root.position.copy(truck.pos); T.root.rotation.y = truck.heading;
  // exhaust puffs
  if (game.engine && Math.random() < 0.3 + Math.abs(truck.speed) * 0.05) {
    const p = new THREE.Vector3(); T.exhaust.getWorldPosition(p);
    fx.exhaust.add(p, new THREE.Vector3(0, 1.2, 0).addScaledVector(fwd, -truck.speed * 0.3), 0.2, 1.1, 1.4);
  }
  if (Math.abs(truck.speed) < 0.01 && !truck.target && game.engine && S.t - (game.lastMove || 0) > 12) { game.engine = false; A.engineOn(false); S.headlights = false; }
  if (Math.abs(truck.speed) > 0.05) game.lastMove = S.t;
}
const OFFS = [3.0, 0, -3.0];
function collide() {
  for (let it = 0; it < 2; it++) for (const oz of OFFS) {
    const cx = truck.pos.x + Math.sin(truck.heading) * oz, cz = truck.pos.z + Math.cos(truck.heading) * oz, R = 1.35;
    for (const o of W.obstacles) {
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
  if (game.catPending) { game.catPending = false; setTimeout(ladderButton, 400); return; }
  const f = activeFire();
  if (f && f.pos.distanceTo(truck.pos) < 17 && !game.arrived) { game.arrived = true; say('fire_arrive'); pulse('spray', true); }
  else if (!f) say('park');
}

// ---------------------------------------------------------------- ladder, water, fires, the kitten
function activeFire() { return fires.find(f => f.active) || null; }
function ladderButton() {
  const S = T.state;
  if (Math.abs(truck.speed) > 0.3 || truck.target) {          // moving: stop first, then raise
    truck.target = null; marker.visible = false; truck.manual.thr = 0;
    clearTimeout(game.ladderRetry); game.ladderRetry = setTimeout(ladderButton, 700); return;
  }
  const cat = W.cat; const cp = new THREE.Vector3(); cat.group.getWorldPosition(cp);
  if (game.catPhase === 'tree' && cp.distanceTo(truck.pos) < 15) {
    game.catPhase = 'reaching'; S.outrig = 1; setBtn('outriggers', 1); A.whir(1.6);
    setTimeout(() => { aimLadder(T, cp.clone().add(new THREE.Vector3(0, 0.3, 0)), 'reach'); A.whir(2.4); }, 1200);
    say('ladder_up'); setBtn('ladder', 1); return;
  }
  const up = !(S.elevT > 0 || S.extT > 0);
  if (up) { S.outrig = 1; setBtn('outriggers', 1); setTimeout(() => { S.elevT = 0.75; S.extT = 0.5; S.yawT = 0; A.whir(2.4); }, S.outrigT > 0.9 ? 0 : 1200); say('ladder_up'); }
  else { stowLadder(T); A.whir(2.2, false); say('ladder_down'); setTimeout(() => { if (!(S.elevT > 0)) { S.outrig = 0; setBtn('outriggers', 0); } }, 3500); }
  setBtn('ladder', up);
}
function fireButton() {
  let f = activeFire();
  if (!f) { startFire(); return; }
  const h = W.houses[fires.indexOf(f)]; driveTo(h.parkAt.clone(), true); say('drive');
  if (!A.sirenIsOn()) ACTIONS.siren();
}
function startFire(idx) {
  const free = fires.map((f, i) => i).filter(i => !fires[i].active);
  const i = idx ?? free[Math.floor(Math.random() * free.length)];
  const f = fires[i]; f.start(); game.arrived = false; game.halfSaid = false; game.mission = i;
  W.houses[i].windows.forEach(w => { w.material.emissive.set('#ff6a1a'); w.material.emissiveIntensity = 1.4; });
  say('fire_alarm'); setTimeout(() => say('fire_go', { queue: true }), 200);
  A.bell(1.3); setTimeout(() => A.bell(1.3), 300); setTimeout(() => A.bell(1.3), 600);
  pulse('fire', true);
  alertIcon.visible = true; alertIcon.position.copy(f.pos).add(new THREE.Vector3(0, 5.5, 0));
}
const alertIcon = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(128, 128, 110, 0, 7); g.fill(); g.strokeStyle = '#ff3b2f'; g.lineWidth = 16; g.stroke();
  g.font = '140px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🔥', 128, 140);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false })); s.scale.setScalar(2.6); s.visible = false; s.renderOrder = 20; scene.add(s); return s;
})();
function pulse(act, on) { const b = document.querySelector(`[data-act="${act}"]`); if (b) b.classList.toggle('pulse', on); }

const nPos = new THREE.Vector3(), nDir = new THREE.Vector3();
function updateWater(dt) {
  const S = T.state, f = activeFire();
  const burst = game.burstUntil && S.t < game.burstUntil;
  const wantSpray = game.spray || burst;
  // aim: at the fire if there is one in reach; otherwise a happy fountain over the yard
  if (wantSpray && Math.abs(truck.speed) < 0.3) {
    if (f && f.pos.distanceTo(truck.pos) < 19) {
      if (!S.outrig) { S.outrig = 1; setBtn('outriggers', 1); A.whir(1.6); }
      if (S.outrigT > 0.95) aimLadder(T, f.pos.clone().add(new THREE.Vector3(0, 1.3, 0)), 'spray');
      setBtn('ladder', 1); pulse('spray', false);
    } else if (!(S.elevT > 0) && game.catPhase !== 'reaching') { S.outrig = 1; setBtn('outriggers', 1); if (S.outrigT > 0.95) { S.elevT = 0.55; S.extT = 0.25; S.nozPitchT = 0.35; } }
  }
  S.aimDir = null;
  if (f && wantSpray && f.pos.distanceTo(truck.pos) < 19 && S.elev > 0.08) {
    nozzleWorld(T, nPos, nDir);
    const Q = f.pos.clone().add(new THREE.Vector3(0, 0.9, 0)), dx = Q.x - nPos.x, dz = Q.z - nPos.z, d = Math.hypot(dx, dz), dy = Q.y - nPos.y;
    const v = 15.5, g = 9.8, disc = v ** 4 - g * (g * d * d + 2 * dy * v * v);
    const th = disc > 0 ? Math.atan((v * v - Math.sqrt(disc)) / (g * Math.max(d, 0.5))) : Math.PI / 4;
    S.aimDir = new THREE.Vector3(dx / d * Math.cos(th), Math.sin(th), dz / d * Math.cos(th));
  }
  const ready = S.elev > 0.08 && !ladderBusy(T) || (S.elev > 0.08 && burst);
  const spraying = wantSpray && ready;
  if (spraying !== S.spraying) { S.spraying = spraying; A.waterOn(spraying); if (spraying) sayOnce('spray'); }
  if (spraying) { nozzleWorld(T, nPos, nDir); fx.water.emit(nPos, nDir, 220, dt, 15.5, 0.05); }
  // valve squirts from the pump panel, and the hydrant fountain
  for (const sq of game.squirts) if (S.t < sq.until) {
    sq.v.out.getWorldPosition(nPos); const q = new THREE.Quaternion(); sq.v.out.getWorldQuaternion(q);
    nDir.set(-1, 0.25, 0).applyQuaternion(q).normalize(); fx.water.emit(nPos, nDir, 90, dt, 5, 0.12);
  }
  game.squirts = game.squirts.filter(s => S.t < s.until);
  if (game.hydrantUntil && S.t < game.hydrantUntil) { nPos.copy(W.hydrant.position).setY(1.25); nDir.set(0, 1, 0); fx.water.emit(nPos, nDir, 120, dt, 7.5, 0.35); }
  // collisions: fires
  const colliders = fires.map(fi => ({ active: fi.active, pos: fi.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), r: 2.2, fire: fi }));
  fx.water.update(dt, colliders);
  for (const h of fx.water.hits) if (h.fire && h.fire.douse(0.0016, fx.steam)) extinguished(h.fire);
  if (f && f.hp < 0.5 && !game.halfSaid) { game.halfSaid = true; say('fire_half'); }
}
function extinguished(f) {
  const i = fires.indexOf(f);
  W.houses[i].windows.forEach(w => { w.material.emissive.set('#18323f'); w.material.emissiveIntensity = 0.25; });
  alertIcon.visible = false; pulse('fire', false); pulse('spray', false);
  fx.confetti.burst(f.pos.clone().add(new THREE.Vector3(0, 2, 0)), 260);
  A.fanfare(); say('fire_out'); T.kids.jiawen.t = T.state.t + 0.3; T.kids.bowen.t = T.state.t + 0.5;
  setTimeout(() => addStar(f.pos.clone().add(new THREE.Vector3(0, 3, 0))), 1600);
  game.nextFireAt = T.state.t + 60; game.arrived = false;
}

function updateCat(dt) {
  const S = T.state, cat = W.cat;
  if (game.catPhase === 'tree') { cat.group.rotation.y = Math.sin(S.t * 1.3) * 0.4; cat.group.position.y = cat.home.y + Math.abs(Math.sin(S.t * 3)) * 0.04; if (Math.random() < dt * 0.15) A.meow(); }
  if (game.catPhase === 'reaching') {
    const tip = tipWorld(T, new THREE.Vector3()), cp = cat.group.getWorldPosition(new THREE.Vector3());
    if (!ladderBusy(T) && S.elev > 0.1 && tip.distanceTo(cp) < 2.6) {
      // the kitten hops onto the ladder tip
      T.ladder.basket.attach(cat.group); game.catPhase = 'riding'; A.meow(); A.sparkle();
      cat.group.position.set(0, 0.05, 0.3); cat.group.rotation.set(0, 0, 0);
      setTimeout(() => { stowLadder(T); A.whir(2.4, false); }, 1200);
    } else if (!ladderBusy(T) && S.elev > 0.1 && S.t > (game.reachRetry || 0)) { game.reachRetry = S.t + 2; aimLadder(T, cp.clone().add(new THREE.Vector3(0, 0.3, 0)), 'reach'); }
  }
  if (game.catPhase === 'riding' && !ladderBusy(T) && S.elev < 0.02) {
    // down on the ground, next to the truck, and a thank-you
    scene.attach(cat.group); game.catPhase = 'saved';
    const side = new THREE.Vector3(2.4, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), truck.heading).add(truck.pos);
    game.catJump = { from: cat.group.position.clone(), to: side, t: 0 };
    S.outrig = 0; setBtn('outriggers', 0); setBtn('ladder', 0);
  }
  if (game.catJump) {
    const j = game.catJump; j.t += dt; const k = Math.min(1, j.t / 0.9);
    cat.group.position.lerpVectors(j.from, j.to, k); cat.group.position.y = THREE.MathUtils.lerp(j.from.y, 0, k) + Math.sin(k * Math.PI) * 1.5;
    if (k >= 1) { game.catJump = null; say('cat_saved'); A.meow(); fx.confetti.burst(cat.group.position.clone().add(new THREE.Vector3(0, 1, 0)), 120); A.fanfare(); setTimeout(() => addStar(cat.group.position.clone().add(new THREE.Vector3(0, 1, 0))), 1200); }
  }
  if (game.catPhase === 'saved' && !game.catJump) { cat.group.rotation.y += dt * 0.6; cat.group.position.y = Math.abs(Math.sin(S.t * 4)) * 0.12; }
}

// ---------------------------------------------------------------- camera
const camGoal = new THREE.Vector3(), lookGoal = new THREE.Vector3();
let focus = null;
function focusCamera(kind) { focus = { kind, until: performance.now() / 1000 + 2.5 }; }
function blocked(p) {
  const sp = STATION.pos;
  if (Math.abs(p.x - sp.x) < 8.5 && Math.abs(p.z - sp.z) < 7.5) return true;
  for (const o of W.obstacles) if (o.r) {
    const d = Math.hypot(p.x - o.x, p.z - o.z);
    if (o.r > 2 && d < o.r + 1.5) return true;            // houses
    if (o.r <= 2 && p.y < 9 && d < o.r + 3.0) return true; // tree canopies
  }
  return Math.hypot(p.x, p.z) > LIMIT + 6;
}
function updateCamera(dt) {
  const now = performance.now() / 1000;
  const S = T.state;
  const center = truck.pos.clone().add(new THREE.Vector3(0, 1.8, 0));
  const f = activeFire();
  const fighting = f && (S.spraying || game.spray) && f.pos.distanceTo(truck.pos) < 19;
  // the action camera: frame the truck and what it is working on (a fire, the kitten)
  let focusP = null;
  if (fighting) focusP = f.pos.clone().setY(3);
  if (['reaching', 'riding'].includes(game.catPhase) || game.catJump) focusP = W.cat.group.getWorldPosition(new THREE.Vector3());
  if (focusP) {
    center.lerp(focusP, 0.5);
    if (now > game.userOrbitUntil) {
      const span = Math.hypot(focusP.x - truck.pos.x, focusP.z - truck.pos.z);
      const perp = new THREE.Vector3(-(focusP.z - truck.pos.z), 0, focusP.x - truck.pos.x).normalize();
      if (perp.dot(camera.position.clone().sub(center)) < 0) perp.negate();
      const dist = Math.max(16, span * 1.5), hgt = 6.5 + span * 0.25;
      let ok = false;
      for (const [side, lift] of [[1, 0], [-1, 0], [1, 4], [-1, 4], [1, 9]]) {
        camGoal.copy(center).addScaledVector(perp, side * dist).setY(hgt + lift);
        if (!blocked(camGoal)) { ok = true; break; }
      }
      camera.position.lerp(camGoal, 1 - Math.exp(-1.6 * dt));
    }
  }
  if (S.elev > 0.08 && !fighting) { const tip = tipWorld(T, new THREE.Vector3()); center.lerp(tip, 0.4); }
  controls.target.lerp(center, 1 - Math.exp(-4 * dt));
  // pull the camera back so the raised ladder and the water stay in view
  const need = (S.elev > 0.08 || S.spraying) ? 21 + S.ext * 6 : 0;
  if (need && now > game.userOrbitUntil && !focusP) {
    const off = camera.position.clone().sub(controls.target), d = off.length();
    if (d < need) camera.position.copy(controls.target).addScaledVector(off.normalize(), d + (need - d) * (1 - Math.exp(-2 * dt)));
  }
  const moving = Math.abs(truck.speed) > 0.5;
  if ((game.mode === 'chase' || moving) && now > game.userOrbitUntil && !focusP) {
    // try a few places around the truck (behind first) and take the first one that is not inside a building
    const back = moving ? 15 : 13;
    for (const a of [Math.PI - 0.25, Math.PI + 0.25, Math.PI - 0.8, Math.PI + 0.8, Math.PI / 2, -Math.PI / 2, 0.6, -0.6]) {
      const h = truck.heading + a;
      camGoal.set(truck.pos.x + Math.sin(h) * back, 7.5, truck.pos.z + Math.cos(h) * back);
      if (!blocked(camGoal)) break;
    }
    camera.position.lerp(camGoal, 1 - Math.exp(-2.2 * dt));
  }
  const sp = STATION.pos;
  if (Math.abs(camera.position.x - sp.x) < 8.5 && camera.position.z > sp.z - 7.5 && camera.position.z < sp.z + 7.5) camera.position.y = Math.max(camera.position.y, 10.5);
  camera.position.y = Math.max(camera.position.y, 1.2);
  if (focus && now < focus.until) {
    const sideV = new THREE.Vector3(Math.cos(truck.heading), 0, -Math.sin(truck.heading)).multiplyScalar(-1);
    camGoal.copy(truck.pos).addScaledVector(sideV, 10).add(new THREE.Vector3(0, 3.5, 0));
    camera.position.lerp(camGoal, 1 - Math.exp(-2.5 * dt));
  }
  controls.update();
  // the sun's shadow box follows the action
  sun.target.position.copy(controls.target); sun.position.copy(controls.target).add(new THREE.Vector3(-18, 30, 14));
}

// ---------------------------------------------------------------- the loop
const clock = new THREE.Clock();
const PROF = { drive: 0, anim: 0, water: 0, fx: 0, render: 0, n: 0 };
const ADAPT = { acc: 0, n: 0, cool: 3 };
function adapt(rawDt) {
  ADAPT.acc += rawDt; ADAPT.n++; ADAPT.cool -= rawDt;
  if (ADAPT.acc < 1.5) return;
  const fps = ADAPT.n / ADAPT.acc; ADAPT.acc = 0; ADAPT.n = 0;
  if (ADAPT.cool > 0) return;
  let next = PR;
  if (fps < 40 && PR > 0.6) next = Math.max(0.6, PR * 0.8);
  else if (fps > 57 && PR < PR_MAX) next = Math.min(PR_MAX, PR * 1.15);
  if (next !== PR) { PR = next; renderer.setPixelRatio(PR); resize(); ADAPT.cool = 2; }
}
function frame() {
  const raw = clock.getDelta(), dt = Math.min(0.05, raw);
  if (game.started) adapt(raw);
  if (T && game.started) {
    const S = T.state, P = PROF, t0 = performance.now();
    updateDriving(dt); const t1 = performance.now();
    animateTruck(T, dt); const t2 = performance.now();
    updateWater(dt); const t3 = performance.now();
    updateCat(dt);
    P.drive += t1 - t0; P.anim += t2 - t1; P.water += t3 - t2;
    // fires: one at a time; a new one after a while
    for (const fi of fires) { fi.update(dt, camera, fx.smoke, fx.embers, fx.steam); if (fi.active) A.crackle(fi.hp * Math.max(0, 1 - fi.pos.distanceTo(camera.position) / 40)); }
    if (!activeFire() && S.t > game.nextFireAt && !truck.target && Math.abs(truck.speed) < 0.1) { startFire(); game.nextFireAt = S.t + 9999; }
    if (alertIcon.visible) alertIcon.position.y = activeFire() ? activeFire().pos.y + 5.2 + Math.sin(S.t * 3) * 0.3 : 0;
    // station door rolls up when the truck is near it
    const near = truck.pos.distanceTo(STATION.pos) < 14 ? 1 : 0; const d = W.stationDoor;
    d.userData.open += (near - d.userData.open) * Math.min(1, dt * 1.5); d.scale.y = 1 - 0.93 * d.userData.open;
    if (marker.visible) { marker.userData.t += dt; marker.material.opacity = 0.6 + 0.3 * Math.sin(marker.userData.t * 8); marker.scale.setScalar(1 + 0.1 * Math.sin(marker.userData.t * 8)); }
    const t4 = performance.now();
    for (const p of fx.puffs) p.update(dt);
    fx.confetti.update(dt); P.fx += performance.now() - t4;
    W.update.forEach(u => u(dt));
    updateCamera(dt);
    // the floating label for a tool
    if (label) {
      if (performance.now() / 1000 > label.until) { labelEl.classList.remove('show'); label = null; }
      else { const p = toScreen(label.obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.0, 0))); labelEl.style.left = p.x + 'px'; labelEl.style.top = p.y + 'px'; }
    }
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toastEl.classList.remove('show'); }
  } else controls.update();
  const t5 = performance.now(); renderer.render(scene, camera); PROF.render += performance.now() - t5; PROF.n++;
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- start
(async () => {
  T = await loadTruck();
  scene.add(T.root);
  T.root.position.copy(truck.pos);
  controls.target.set(truck.pos.x, 1.8, truck.pos.z);
  document.body.classList.add('loaded');
  window.TOY = { THREE, PROF, getPR: () => PR, T, W, game, truck, fires, fx, camera, controls, ACTIONS, handleTap, driveTo, startFire, say, scene, renderer };
  requestAnimationFrame(frame);
})();
$('#start').addEventListener('pointerdown', e => {
  e.preventDefault(); A.unlock();
  $('#title').classList.add('hide'); game.started = true;
  setTimeout(() => { say('welcome'); T.state.lights = true; setBtn('lights', true); A.bell(); setTimeout(() => A.bell(1.02), 260); T.kids.jiawen.t = T.state.t + 0.4; T.kids.bowen.t = T.state.t + 0.8; }, 400);
  setTimeout(() => { T.state.lights = false; setBtn('lights', false); }, 6000);
});
