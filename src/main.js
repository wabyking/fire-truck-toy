// 佳文和博文的消防车 — an interactive fire truck toy with levels, for 3–5-year-olds.
// Boot, rendering (with a bloom pass for night glows), the buttons and taps, the level menu, the level flow and results.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { loadTruck } from './truck.js';
import { buildWorld } from './world.js';
import { makeFx } from './fx.js';
import { Traffic } from './traffic.js';
import { createPlay } from './play.js';
import { LEVELS } from './levels.js';
import * as A from './audio.js';
import { VOICE_TEXT } from './assets.js';

// ---------------------------------------------------------------- renderer, scene, camera, lights
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let PR = Math.min(window.devicePixelRatio, 2); const PR_MAX = PR;
renderer.setPixelRatio(PR);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#d9eefc', 70, 190);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 900);
camera.position.set(-11, 6.5, -6);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 7; controls.maxDistance = 48;
controls.maxPolarAngle = 1.42; controls.enablePan = false; controls.rotateSpeed = 0.7; controls.zoomSpeed = 0.8;
const hemi = new THREE.HemisphereLight('#dff1ff', '#7a9a5a', 1.25); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff4e0', 2.6); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 90 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; scene.add(sun, sun.target);
const lights = { hemi, sun, sunOffset: new THREE.Vector3(-18, 30, 14) };

// post: bloom for lights and fire (always at night; in the day only when the device has headroom)
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.4, 0.45, 0.88); composer.addPass(bloom);
composer.addPass(new OutputPass());
const Q = { bloomDay: false };

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); composer.setPixelRatio(PR); composer.setSize(w, h);
  bloom.resolution.set(Math.round(w * PR / 2), Math.round(h * PR / 2));
  camera.aspect = w / h; if (!G || G.camMode !== 'cab') camera.fov = w / h < 1 ? 58 : 42; camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- UI helpers (the engine talks to the page through these)
const $ = s => document.querySelector(s);
const toastEl = $('#toast'), labelEl = $('#label'), starsEl = $('#stars');
let toastTimer = 0, label = null;
const ui = {
  say(id, opt) { const d = A.say(id, opt); const t = VOICE_TEXT[id]; if (t) { toastEl.textContent = t; toastEl.classList.add('show'); toastTimer = Math.max(2.2, (d || 2) + 0.6); } },
  setBtn(id, on) { const b = document.querySelector(`[data-act="${id}"]`); if (b) b.classList.toggle('on', !!on); },
  pulse(id, on) { const b = document.querySelector(`[data-act="${id}"]`); if (b) b.classList.toggle('pulse', !!on); },
  showLabel(text, obj, secs = 3) { label = { obj, until: performance.now() / 1000 + secs }; labelEl.textContent = text; labelEl.classList.add('show'); },
  setTank(v) { const t = $('#tank'); t.querySelector('.fill').style.height = v.toFixed(1) + '%'; t.classList.toggle('low', v < 25); },
  setAgent(a) { $('#agentIc').textContent = a === 'foam' ? '🧼' : '💧'; $('#agentTx').textContent = a === 'foam' ? '泡沫' : '水'; $('#tank').classList.toggle('foam', a === 'foam'); $('#tank .ic').textContent = a === 'foam' ? '🧼' : '💧'; },
  setView(m) { $('#viewTx').textContent = { follow: '跟随', cab: '驾驶室', free: '自由' }[m]; },
};
const toScreen = v => { const p = v.clone().project(camera); return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight }; };

// ---------------------------------------------------------------- progress (kept in the browser)
const KEY = 'fireTruckToy.v2';
const progress = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || { best: {} }; } catch { return { best: {} }; } })();
const saveProgress = () => { try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch {} };
const totalStars = () => Object.values(progress.best).reduce((a, b) => a + b, 0);
const unlocked = id => id === 1 || (progress.best[id - 1] || 0) >= 1 || (progress.best[id] || 0) > 0;
function showStars() { starsEl.querySelector('b').textContent = totalStars(); }
function flyStar(fromWorld) {
  const fly = document.createElement('div'); fly.className = 'flystar'; fly.textContent = '⭐';
  const p = fromWorld ? toScreen(fromWorld) : { x: innerWidth / 2, y: innerHeight / 2 };
  fly.style.left = p.x + 'px'; fly.style.top = p.y + 'px'; document.body.appendChild(fly);
  requestAnimationFrame(() => { const r = starsEl.getBoundingClientRect(); fly.style.left = r.left + 20 + 'px'; fly.style.top = r.top + 10 + 'px'; fly.style.transform = 'scale(0.6)'; });
  setTimeout(() => { fly.remove(); starsEl.classList.add('bump'); setTimeout(() => starsEl.classList.remove('bump'), 400); A.sparkle(); }, 1100);
}

// ---------------------------------------------------------------- world, truck, engine
const W = buildWorld(scene);
const fx = makeFx(scene);
for (const p of [...fx.puffs, fx.water.mist, fx.foam.mist]) p.cam = camera;
const traffic = new Traffic(scene, 4);
let T = null, G = null;
window.addEventListener('resize', resize); resize();
// the tank gauge and (on an upright phone) the drive pad sit just above the button dock, however many rows it has
new ResizeObserver(() => document.documentElement.style.setProperty('--dockH', $('#dock').offsetHeight + 'px')).observe($('#dock'));

// ---------------------------------------------------------------- input: buttons, pad, keyboard, taps
const ACT_EXTRA = { night: () => { G.setNight(!W.night); if (W.night) ui.say('night'); } };
function bindButtons() {
  for (const b of document.querySelectorAll('[data-act]')) {
    const act = b.dataset.act;
    if (act === 'spray') {
      const on = e => { e.preventDefault(); A.unlock(); G.spray = true; b.classList.add('on'); };
      const off = () => { G.spray = false; b.classList.remove('on'); };
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
    } else b.addEventListener('pointerdown', e => {
      e.preventDefault(); A.unlock(); b.classList.add('press'); setTimeout(() => b.classList.remove('press'), 180);
      (G.actions[act] || ACT_EXTRA[act] || (() => {}))();
    });
  }
  for (const b of document.querySelectorAll('[data-pad]')) {
    const d = b.dataset.pad, tr = G.truck;
    const on = e => { e.preventDefault(); A.unlock(); tr.target = null; if (d === 'up') tr.manual.thr = 1; if (d === 'down') tr.manual.thr = -1; if (d === 'left') tr.manual.str = 1; if (d === 'right') tr.manual.str = -1; b.classList.add('on'); G.startDriving(); };
    const off = () => { if (d === 'up' || d === 'down') tr.manual.thr = 0; else tr.manual.str = 0; b.classList.remove('on'); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
  }
  const keys = {};
  window.addEventListener('keydown', e => {
    if (keys[e.code] || !G || mode === 'title' || mode === 'menu') return; keys[e.code] = 1; A.unlock();
    const k = e.code, tr = G.truck, act = G.actions;
    if (k === 'ArrowUp' || k === 'KeyW') { tr.manual.thr = 1; tr.target = null; G.startDriving(); }
    if (k === 'ArrowDown' || k === 'KeyS') { tr.manual.thr = -1; tr.target = null; G.startDriving(); }
    if (k === 'ArrowLeft' || k === 'KeyA') { tr.manual.str = 1; tr.target = null; }
    if (k === 'ArrowRight' || k === 'KeyD') { tr.manual.str = -1; tr.target = null; }
    if (k === 'Space') G.spray = true;
    const map = { KeyL: 'lights', KeyN: 'siren', KeyH: 'horn', KeyB: 'bell', KeyT: 'tools', KeyU: 'ladder', KeyO: 'outriggers', KeyF: 'fire', KeyC: 'view', KeyG: 'agent', KeyR: 'doors' };
    if (map[k]) act[map[k]]();
  });
  window.addEventListener('keyup', e => {
    keys[e.code] = 0; if (!G) return; const k = e.code, tr = G.truck;
    if (['ArrowUp', 'KeyW', 'ArrowDown', 'KeyS'].includes(k)) tr.manual.thr = 0;
    if (['ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD'].includes(k)) tr.manual.str = 0;
    if (k === 'Space') G.spray = false;
  });
  // taps on the 3D world
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let down = null;
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; G.userOrbitUntil = performance.now() / 1000 + 3; A.unlock(); });
  canvas.addEventListener('pointerup', e => {
    if (!down || mode === 'menu') return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t; down = null;
    if (moved > 10 || dt > 600) return;
    ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
    const targets = [...T.tappables, ...W.tappables, W.ground];
    traffic.cars.forEach(c => c.g.children.forEach(m => targets.push(m)));
    G.burntCar.children.forEach(m => targets.push(m));
    for (const h of ray.intersectObjects(targets, false)) {
      if (!h.object.visible || (h.object.parent && !h.object.parent.visible)) continue;
      if (h.object.material && h.object.material.name === 'Glass') continue;
      let o = h.object, tap = null; while (o && !tap) { tap = o.userData && o.userData.tap; if (!tap) o = o.parent; }
      if (h.object === W.ground) { G.driveTo(h.point); return; }
      if (tap) { G.handleTap(tap, o, h); return; }
      if (T.tappables.includes(h.object)) { A.pop(0.8); return; }
    }
  });
  $('#mute').addEventListener('click', () => { A.unlock(); const m = $('#mute'); m.classList.toggle('off'); A.setMuted(m.classList.contains('off')); });
  $('#full').addEventListener('click', () => {
    const d = document.documentElement, fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fs) (d.requestFullscreen || d.webkitRequestFullscreen || (() => {})).call(d); else (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  });
  $('#home').addEventListener('click', () => { A.unlock(); openMenu(); });
}

// ---------------------------------------------------------------- the level menu
let mode = 'title', level = null, L = null, levelT = 0, finished = false, goalState = [];
function openMenu() {
  if (level) endLevel();
  mode = 'menu';
  const cards = $('#cards'); cards.innerHTML = '';
  const free = document.createElement('button'); free.className = 'card free';
  free.innerHTML = `<div class="ic">🎈</div><div class="no">随便玩</div><div class="nm">自由玩</div><div class="st">&nbsp;</div>`;
  free.addEventListener('click', () => { A.unlock(); A.pop(1.2); startFree(); });
  for (const lv of LEVELS) {
    const c = document.createElement('button'), best = progress.best[lv.id] || 0, open = unlocked(lv.id);
    c.className = 'card' + (open ? '' : ' locked');
    c.innerHTML = `<div class="ic">${lv.icon}</div><div class="no">第 ${lv.id} 关</div><div class="nm">${lv.name}</div><div class="st">${[1, 2, 3].map(i => `<span class="${i <= best ? '' : 'off'}">★</span>`).join('')}</div>`;
    c.addEventListener('click', () => { A.unlock(); if (!open) { A.pop(0.6); return; } A.pop(1.2); startLevel(lv); });
    cards.appendChild(c);
  }
  cards.appendChild(free);
  $('#menu').classList.remove('hide'); $('#result').classList.add('hide'); $('#goals').classList.add('hide'); $('#home').classList.add('hide'); document.body.classList.remove('playing');
  showStars(); ui.say('menu_pick');
}
function hudFor(lv) {
  document.querySelector('[data-act="fire"]').classList.toggle('hide', !!lv && !/火/.test(lv.name + lv.desc));
  document.querySelector('[data-act="night"]').classList.toggle('hide', !!lv);
}
function startLevel(lv) {
  mode = 'level'; level = lv; L = {}; finished = false; levelT = -3.2;
  $('#menu').classList.add('hide'); $('#result').classList.add('hide'); $('#home').classList.remove('hide'); document.body.classList.add('playing');
  G.reset(lv.reset); hudFor(lv);
  lv.setup && lv.setup(G, L);
  // goals panel
  $('#gtitle').textContent = `第 ${lv.id} 关 · ${lv.name}`;
  const list = $('#glist'); list.innerHTML = '';
  goalState = lv.goals.map(g => { const d = document.createElement('div'); d.className = 'g'; d.innerHTML = `<span class="ic">${g.icon}</span><span class="tx">${g.text}</span><span class="pg"></span><span class="ck"></span>`; list.appendChild(d); return { g, el: d, done: false }; });
  $('#goals').classList.remove('hide');
  // intro card
  const it = $('#intro'); it.querySelector('.ic').textContent = lv.icon; it.querySelector('.lv').textContent = `第 ${lv.id} 关`;
  it.querySelector('.nm').textContent = lv.name; it.querySelector('.ds').textContent = lv.desc; it.classList.remove('hide');
  setTimeout(() => it.classList.add('hide'), 3000);
  setTimeout(() => ui.say(lv.intro), 300);
  if (lv.reset.night) setTimeout(() => ui.say('night', { queue: true }), 600);
}
function startFree() {
  mode = 'free'; level = null; L = null;
  $('#menu').classList.add('hide'); $('#goals').classList.add('hide'); $('#home').classList.remove('hide'); document.body.classList.add('playing');
  G.reset({ start: 'apron', traffic: true, cat: true, freeFires: true }); hudFor(null);
  setTimeout(() => ui.say('free_play'), 300);
}
function endLevel() { if (level && level.cleanup) level.cleanup(G, L); level = null; L = null; G.off(); }
function tickLevel(dt) {
  if (!level || finished) return;
  levelT += dt;
  level.tick && level.tick(G, L, dt);
  let firstOpen = -1;
  goalState.forEach((s, i) => {
    const nowDone = !!s.g.done(G);
    if (s.g.progress) s.el.querySelector('.pg').textContent = s.g.progress(G);
    if (nowDone && !s.done) {
      s.done = true; s.el.classList.add('done'); A.ding();
      const nxt = goalState.find(x => !x.done);
      if (level.ordered && nxt && nxt.g.voice) setTimeout(() => ui.say(nxt.g.voice, { queue: true }), 1300);
    }
    if (!s.done && firstOpen < 0) firstOpen = i;
  });
  goalState.forEach((s, i) => { s.el.classList.toggle('later', level.ordered && !s.done && i > firstOpen); s.el.classList.toggle('now', !s.done && i === firstOpen); });
  $('#timer').textContent = levelT > 0 ? `⏱ ${Math.floor(levelT)} 秒` : '';
  if (firstOpen < 0) { finished = true; setTimeout(showResult, 2600); }
}
function showResult() {
  const lv = level; if (!lv) return;
  const t = Math.max(0, levelT), stars = t <= lv.stars[0] ? 3 : t <= lv.stars[1] ? 2 : 1;
  const prev = progress.best[lv.id] || 0, wasUnlocked = unlocked(lv.id + 1);
  progress.best[lv.id] = Math.max(prev, stars); saveProgress();
  const r = $('#result'); r.classList.remove('hide'); mode = 'result';
  const sp = [...r.querySelectorAll('.rs span')]; sp.forEach(s => s.classList.remove('got'));
  r.querySelector('.tm').textContent = `用时 ${Math.round(t)} 秒`;
  $('#next').classList.toggle('hide', lv.id >= LEVELS.length);
  ui.say('level_done');
  sp.forEach((s, i) => { if (i < stars) setTimeout(() => { s.classList.add('got'); A.bell(1 + i * 0.25); if (i === stars - 1) { A.fanfare(); } }, 700 + i * 450); });
  for (let i = 0; i < stars - prev; i++) setTimeout(() => { flyStar(); showStars(); }, 1800 + i * 300);
  setTimeout(() => ui.say('stars' + stars, { queue: true }), 1900);
  if (!wasUnlocked && unlocked(lv.id + 1) && lv.id < LEVELS.length) setTimeout(() => ui.say('unlock', { queue: true }), 2000);
  if (LEVELS.every(l => progress.best[l.id]) && lv.id === LEVELS.length) setTimeout(() => ui.say('all_done', { queue: true }), 2100);
}
$('#again').addEventListener('click', () => { A.unlock(); const lv = level; endLevel(); startLevel(lv); });
$('#next').addEventListener('click', () => { A.unlock(); const lv = LEVELS.find(l => l.id === level.id + 1); endLevel(); if (lv) startLevel(lv); });
$('#tomenu').addEventListener('click', () => { A.unlock(); openMenu(); });

// ---------------------------------------------------------------- the loop and adaptive quality
const clock = new THREE.Clock();
const ADAPT = { acc: 0, n: 0, cool: 3 };
function adapt(raw) {
  ADAPT.acc += raw; ADAPT.n++; ADAPT.cool -= raw;
  if (ADAPT.acc < 1.5) return;
  const fps = ADAPT.n / ADAPT.acc; ADAPT.acc = 0; ADAPT.n = 0;
  if (ADAPT.cool > 0) return;
  if (fps < 40) {
    if (Q.bloomDay) { Q.bloomDay = false; ADAPT.cool = 2; return; }
    if (PR > 0.6) { PR = Math.max(0.6, PR * 0.8); renderer.setPixelRatio(PR); resize(); ADAPT.cool = 2; }
  } else if (fps > 57) {
    if (PR < PR_MAX) { PR = Math.min(PR_MAX, PR * 1.15); renderer.setPixelRatio(PR); resize(); ADAPT.cool = 2; }
    else if (!Q.bloomDay && !Q.bloomTried) { Q.bloomDay = true; Q.bloomTried = true; ADAPT.cool = 3; }
  }
}
function frame() {
  const raw = clock.getDelta(), dt = Math.min(0.05, raw);
  if (G && mode !== 'title') {
    adapt(raw);
    G.update(dt);
    tickLevel(dt);
    for (const p of fx.puffs) p.update(dt);
    fx.confetti.update(dt);
    W.update.forEach(u => u(dt));
    if (label) {
      if (performance.now() / 1000 > label.until) { labelEl.classList.remove('show'); label = null; }
      else { const p = toScreen(label.obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.0, 0))); labelEl.style.left = p.x + 'px'; labelEl.style.top = p.y + 'px'; }
    }
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toastEl.classList.remove('show'); }
  } else controls.update();
  const night = W.night > 0;
  if (night || Q.bloomDay) {
    bloom.strength = night ? 0.85 : 0.3; bloom.threshold = night ? 0.55 : 0.9; bloom.radius = night ? 0.55 : 0.4;
    composer.render();
  } else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- start
(async () => {
  T = await loadTruck();
  scene.add(T.root);
  G = createPlay({ scene, camera, controls, renderer, W, T, fx, traffic, ui, lights });
  G.reset({ start: 'apron', traffic: true });
  bindButtons(); showStars(); resize();
  // reward stars on the fly for rescues and fires in free play
  document.body.classList.add('loaded');
  window.TOY = { THREE, T, W, G, fx, camera, controls, scene, renderer, LEVELS, startLevel, openMenu, startFree, progress, getPR: () => PR, Q, get mode() { return mode; }, get L() { return L; }, get levelT() { return levelT; } };
  requestAnimationFrame(frame);
})();
$('#start').addEventListener('pointerdown', e => {
  e.preventDefault(); A.unlock();
  $('#title').classList.add('fade'); setTimeout(() => $('#title').classList.add('hide'), 600);
  ui.say('welcome'); A.bell(); setTimeout(() => A.bell(1.02), 260);
  T.kids.jiawen.t = T.state.t + 0.4; T.kids.bowen.t = T.state.t + 0.8;
  setTimeout(openMenu, 2600);
});
