// The truck from Blender: load the glb, find every pivot by name, add the decals, and animate all moving parts
// from a small state object (doors, shutters, lights, ladder, outriggers, valves, reel, bell, kids, wipers, wheels).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TRUCK_GLB } from './assets.js';

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const approach = (a, b, rate, dt) => (Math.abs(b - a) <= rate * dt ? b : a + Math.sign(b - a) * rate * dt);

function b64ToBuffer(b64) {
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const FONT = '"Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif';

export async function loadTruck() {
  const gltf = await new GLTFLoader().parseAsync(b64ToBuffer(TRUCK_GLB), '');
  const model = gltf.scene;
  const N = {};
  model.traverse(o => {
    N[o.name] = o;
    if (o.isMesh) {                         // small parts do not need to cast shadows
      o.geometry.computeBoundingSphere(); o.castShadow = o.geometry.boundingSphere.radius > 0.3; o.receiveShadow = true;
    }
  });
  const T = { model, N, mats: {}, state: newState(), tappables: [] };
  model.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) T.mats[m.name] = m; });
  // materials the page drives
  for (const k of ['Light_Red', 'Light_Blue', 'Light_Amber', 'Light_Head', 'Light_Tail', 'Light_Work', 'Light_Bay', 'Gauge_Face', 'Light_TurnL', 'Light_TurnR', 'Light_Reverse']) {
    const m = T.mats[k]; if (!m) continue; m.emissiveIntensity = 0; m.toneMapped = true;
  }
  if (T.mats.Glass) { T.mats.Glass.transparent = true; T.mats.Glass.opacity = 0.28; T.mats.Glass.depthWrite = false; T.mats.Glass.envMapIntensity = 1.5; }
  for (const k of ['Paint_Red', 'Paint_RedDark', 'Paint_White']) if (T.mats[k]) T.mats[k].envMapIntensity = 0.9;
  for (const k of ['Chrome', 'Aluminium', 'DiamondPlate', 'Brass']) if (T.mats[k]) T.mats[k].envMapIntensity = 1.4;
  if (T.mats.DiamondPlate) { T.mats.DiamondPlate.normalMap = diamondNormal(); T.mats.DiamondPlate.normalScale = new THREE.Vector2(0.6, 0.6); }
  addDecals(T);
  // the pivots
  const P = n => N[n];
  T.doors = { FL: P('Door_FL'), FR: P('Door_FR'), RL: P('Door_RL'), RR: P('Door_RR') };
  T.shutters = {};
  for (const n in N) { const m = n.match(/^Shutter_([LR])_([A-D])$/); if (m) T.shutters[m[1] + m[2]] = N[n]; }
  T.wheels = Object.keys(N).filter(n => /^Wheel_(F|R\d)[LR]$/.test(n)).map(n => N[n]);
  T.steer = [P('Steer_FL'), P('Steer_FR')];
  T.ladder = { tt: P('Ladder_Turntable'), boom: P('Ladder_Boom'), f1: P('Ladder_Fly1'), f2: P('Ladder_Fly2'), nozzle: P('Ladder_Nozzle'), tip: P('Nozzle_Tip'), basket: P('Ladder_Tip'), cage: P('Ladder_Basket'), seat: P('Basket_Seat'), lift: P('Ladder_LiftCyl') };
  T.ladder.f1z = T.ladder.f1.position.z; T.ladder.f2z = T.ladder.f2.position.z;
  T.outriggers = ['FL', 'FR', 'RL', 'RR'].map(k => ({ beam: P('Outrigger_' + k), jack: P('Outrigger_' + k + '_Jack'), sx: k[1] === 'L' ? 1 : -1 }))
    .filter(o => o.beam).map(o => ({ ...o, x0: o.beam.position.x, y0: o.jack.position.y }));
  T.valves = [1, 2, 3, 4].map(i => ({ v: P('Valve_' + i), out: P('Valve_' + i + '_Out'), t: 0 }));
  T.needles = [0, 1, 2].map(i => P(`Gauge_${i}_Needle`));
  T.reel = P('Hose_Reel'); T.bell = P('Bell'); T.wipers = [P('Wiper_L'), P('Wiper_R')];
  T.kids = { jiawen: { root: P('Kid_Jiawen'), arm: P('Kid_Jiawen_Arm'), t: -9 }, bowen: { root: P('Kid_Bowen'), arm: P('Kid_Bowen_Arm'), t: -9 } };
  for (const k in T.kids) { const kd = T.kids[k]; kd.armRot = kd.arm.rotation.clone(); kd.rootY = kd.root.position.y; }
  T.exhaust = P('Exhaust_Tip');
  T.tools = Object.keys(N).filter(n => n.startsWith('Tool_')).map(n => {
    const o = N[n]; return { o, kind: o.userData.tap.split(':')[1], home: o.position.clone(), homeRot: o.rotation.clone(), homeScale: o.scale.clone(), t: -9 };
  });
  // which shutter hides which tool (by position along the body)
  for (const tl of T.tools) {
    let best = null, bd = 1e9;
    for (const [k, s] of Object.entries(T.shutters)) {
      const d = Math.abs(s.position.z - tl.o.position.z) + (Math.sign(s.position.x) === Math.sign(tl.o.position.x) ? 0 : 100);
      if (d < bd) { bd = d; best = k; }
    }
    tl.shutter = best;
  }
  // a real light from the light bar and the headlights (cheap: two point lights and a spot)
  // one light for the beacons: it swaps colour with the flash (a fixed light count keeps the shaders stable)
  T.beacon = new THREE.PointLight('#ff3b2f', 0, 14, 2); T.beacon.position.set(0, 3.6, 3.3); model.add(T.beacon);
  T.head = new THREE.SpotLight('#fff3d6', 0, 26, 0.55, 0.6, 1.5); T.head.position.set(0, 1.2, 4.6); T.head.target.position.set(0, 0, 14); model.add(T.head, T.head.target);
  // tap targets: anything with userData.tap up the parent chain
  model.traverse(o => { if (o.isMesh) T.tappables.push(o); });
  const root = new THREE.Group(); root.add(model); T.root = root;
  return T;
}

function newState() {
  return {
    doors: { FL: 0, FR: 0, RL: 0, RR: 0 }, doorT: { FL: 0, FR: 0, RL: 0, RR: 0 },
    shutters: {}, shutterT: {},
    lights: false, siren: false, headlights: false, work: false,
    yaw: 0, elev: 0.0, ext: 0, yawT: 0, elevT: 0, extT: 0, nozPitch: 0, nozPitchT: 0,
    outrig: 0, outrigT: 0, spraying: false, tank: 100, agent: 'water', turn: 0, braking: false,
    reelSpin: 0, reelV: 0, bellT: -9, wipe: false, speed: 0, steer: 0, wheelA: 0, t: 0,
  };
}

// ---------------------------------------------------------------- decals
function addDecals(T) {
  const N = T.N;
  const plane = (tex, w, h, parent, pos, rotY, name) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.position.copy(pos); m.rotation.y = rotY; m.name = name; m.receiveShadow = true; parent.add(m); return m;
  };
  // front badge: 119 on the grille plate
  const t119 = canvasTex(256, 96, (g, w, h) => { g.fillStyle = '#d9261c'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffffff'; g.font = `bold 78px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('119', w / 2, h / 2 + 4); });
  const fb = N.Decal_Front119; if (fb) plane(t119, 0.48, 0.13, fb.parent, fb.position.clone().add(new THREE.Vector3(0, 0, 0.005)), 0, 'D_front');
  // doors: the kids' names on the front doors, an emblem
  const door = (name, sub) => canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffd23a'; g.beginPath(); g.arc(100, 128, 86, 0, 7); g.fill();
    g.fillStyle = '#d9261c'; g.beginPath(); g.arc(100, 128, 70, 0, 7); g.fill();
    g.fillStyle = '#ffffff'; g.font = `bold 60px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('119', 100, 132);
    g.fillStyle = '#ffffff'; g.font = `bold 76px ${FONT}`; g.textAlign = 'left'; g.fillText(name, 205, 105);
    g.font = `bold 40px ${FONT}`; g.fillStyle = '#ffe27a'; g.fillText(sub, 210, 182);
  });
  for (const [sn, nm, sub] of [['L', '佳文队长', 'CAPTAIN'], ['R', '博文', 'FIREFIGHTER']]) {
    const e = N['Decal_Door_' + sn]; if (!e) continue;
    const sx = sn === 'L' ? 1 : -1;
    plane(door(nm, sub), 0.95, 0.475, e.parent, e.position.clone().add(new THREE.Vector3(sx * 0.03, 0, 0)), sx * Math.PI / 2, 'D_door' + sn);
  }
  // sides: 消防救援 on the panel above the rear wheels
  const side = canvasTex(1024, 128, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.font = `bold 92px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('消防救援  FIRE RESCUE', w / 2, h / 2 + 4);
  });
  for (const sn of ['L', 'R']) {
    const e = N['Decal_Side_' + sn]; if (!e) continue; const sx = sn === 'L' ? 1 : -1;
    plane(side, 2.3, 0.29, e.parent, e.position.clone().add(new THREE.Vector3(sx * 0.02, 0, 0)), sx * Math.PI / 2, 'D_side' + sn);
  }
  // pump panel label
  const pump = canvasTex(512, 96, (g, w, h) => { g.fillStyle = '#1f2a44'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffffff'; g.font = `bold 60px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('水 泵  PUMP', w / 2, h / 2 + 3); });
  const pe = N.Decal_Pump; if (pe) plane(pump, 0.9, 0.17, pe.parent, pe.position.clone().add(new THREE.Vector3(-0.03, 0, 0)), -Math.PI / 2, 'D_pump');
  // rear chevrons
  const chev = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#ffc61a'; g.fillRect(0, 0, w, h); g.fillStyle = '#d9261c';
    for (let x = -h; x < w + h; x += 90) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 45, h); g.lineTo(x + 45 + h * 0.6, 0); g.lineTo(x + h * 0.6, 0); g.fill(); }
  });
  const ce = N.Decal_Chevron; if (ce) plane(chev, 1.18, 0.48, ce.parent, ce.position.clone(), Math.PI, 'D_chev');
}

function diamondNormal() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = 'rgb(128,128,255)'; g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 32) for (let x = (y / 32) % 2 ? 16 : 0; x < 128 + 16; x += 32) {
    g.save(); g.translate(x, y + 16); g.rotate(0.6);
    g.fillStyle = 'rgb(170,150,255)'; g.fillRect(-11, -3, 11, 6); g.fillStyle = 'rgb(86,106,255)'; g.fillRect(0, -3, 11, 6); g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6); return t;
}

// ---------------------------------------------------------------- animation
const v3 = new THREE.Vector3(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), ZF = new THREE.Vector3(0, 0, 1), eu = new THREE.Euler();
export function animateTruck(T, dt) {
  const S = T.state; S.t += dt; const t = S.t;
  // doors swing out; front doors to 70°, crew doors to 80°
  for (const k in T.doors) {
    const d = T.doors[k]; if (!d) continue;
    S.doorT[k] = damp(S.doorT[k], S.doors[k], 5, dt);
    const a = S.doorT[k] * (k[0] === 'F' ? 1.22 : 1.38) * (k[1] === 'L' ? -1 : 1);
    d.rotation.y = a;
  }
  // shutters roll up into their housing
  for (const k in T.shutters) {
    const s = T.shutters[k]; const target = S.shutters[k] ? 1 : 0;
    S.shutterT[k] = approach(S.shutterT[k] || 0, target, 1.4, dt);
    s.scale.y = 1 - 0.94 * S.shutterT[k];
  }
  const anyOpen = Object.values(S.shutterT).some(v => v > 0.05);
  setEmit(T, 'Light_Bay', anyOpen ? 2.2 : 0);
  // the light bar: alternating flashes; the rear beacons; real coloured lights on the ground
  if (S.lights) {
    const ph = (t * 3.2) % 2, a = (ph < 1 ? 1 : 0) * (((t * 16) % 2) < 1.2 ? 1 : 0.15), b = (ph >= 1 ? 1 : 0) * (((t * 16) % 2) < 1.2 ? 1 : 0.15);
    setEmit(T, 'Light_Red', 2 + 9 * a); setEmit(T, 'Light_Blue', 2 + 9 * b); setEmit(T, 'Light_Amber', 3 * (Math.sin(t * 8) > 0 ? 1 : 0));
    if (a > b) T.beacon.color.set('#ff3b2f'); else T.beacon.color.set('#3b7bff');
    T.beacon.intensity = 26 * Math.max(a, b);
  } else {
    setEmit(T, 'Light_Red', 0); setEmit(T, 'Light_Blue', 0); setEmit(T, 'Light_Amber', 0); T.beacon.intensity = 0;
  }
  setEmit(T, 'Light_Head', S.headlights ? 5 : 0.0); T.head.intensity = S.headlights ? (S.night ? 140 : 60) : 0;
  setEmit(T, 'Light_Tail', S.braking ? 7 : (S.headlights ? 2.5 : 0));
  setEmit(T, 'Light_Reverse', S.speed < -0.1 ? 6 : 0);
  const blink = ((t * 1.6) % 1) < 0.55 ? 1 : 0;                 // turn signals and hazards
  setEmit(T, 'Light_TurnL', (S.turn > 0 || S.lights) ? 6 * blink : 0);
  setEmit(T, 'Light_TurnR', (S.turn < 0 || S.lights) ? 6 * blink : 0);
  setEmit(T, 'Light_Work', S.work || S.spraying ? 4 : 0);
  setEmit(T, 'Gauge_Face', 0.25);
  // outriggers: beams slide out, then the jacks press down
  S.outrigT = approach(S.outrigT, S.outrig ? 1 : 0, 0.6, dt);
  const ob = Math.min(1, S.outrigT * 2), oj = Math.max(0, S.outrigT * 2 - 1);
  for (const o of T.outriggers) { o.beam.position.x = o.x0 + o.sx * 0.9 * ob; o.jack.position.y = o.y0 - 0.55 * oj; }
  // the ladder: turntable yaw, boom elevation, two fly sections, the monitor nozzle
  S.yaw = approach(S.yaw, S.yawT, 0.7, dt); S.elev = approach(S.elev, S.elevT, 0.42, dt); S.ext = approach(S.ext, S.extT, 0.35, dt);
  S.nozPitch = approach(S.nozPitch, S.nozPitchT, 1.2, dt);
  const L = T.ladder;
  L.tt.rotation.y = S.yaw;
  L.boom.rotation.x = -S.elev;
  L.f1.position.z = T.ladder.f1z + S.ext * 4.4;
  L.f2.position.z = T.ladder.f2z + S.ext * 4.0;
  if (S.aimDir) {                                              // point the monitor exactly along the solved arc
    L.nozzle.parent.getWorldQuaternion(qa).invert();
    v3.copy(S.aimDir).applyQuaternion(qa).normalize();
    qb.setFromUnitVectors(ZF, v3); L.nozzle.quaternion.slerp(qb, 1 - Math.exp(-8 * dt));
  } else {
    L.nozzle.quaternion.slerp(qb.setFromEuler(eu.set(S.elev * 0.85 - S.nozPitch, 0, 0)), 1 - Math.exp(-8 * dt));   // level-ish, then pitch
  }
  if (L.lift) L.lift.rotation.x = -S.elev * 0.55;
  if (L.cage) L.cage.rotation.x = S.elev;                      // the rescue basket stays level
  // valves (a half turn when tapped) and gauges
  for (const v of T.valves) { if (!v.v) continue; v.v.rotation.x = -Math.PI * 0.5 * Math.min(1, Math.max(0, v.t > 0 ? 1 : 0)) * 0.9; }
  T.needles.forEach((n, i) => { if (n) n.rotation.x = -0.6 + (S.spraying ? 1.6 : 0.2) + Math.sin(t * (1.3 + i) + i) * (S.spraying ? 0.12 : 0.03); });
  // hose reel spins down after a push
  S.reelV = damp(S.reelV, 0, 0.8, dt); S.reelSpin += S.reelV * dt; if (T.reel) T.reel.rotation.x = S.reelSpin;
  // the bell swings
  if (T.bell) { const bt = t - S.bellT; T.bell.rotation.x = bt < 2 ? Math.sin(bt * 22) * 0.5 * Math.exp(-bt * 2.2) : 0; }
  // kids: a wave when tapped (or when something good happens), a little bounce
  for (const k in T.kids) {
    const kd = T.kids[k]; const wt = t - kd.t;
    const s = k === 'jiawen' ? 1 : -1;
    if (wt < 2.4) { const up = Math.min(1, wt * 4) * Math.min(1, (2.4 - wt) * 3); kd.arm.rotation.z = kd.armRot.z + s * up * (2.4 + Math.sin(wt * 14) * 0.35); kd.root.position.y = kd.rootY + Math.abs(Math.sin(wt * 8)) * 0.06 * up; }
    else { kd.arm.rotation.z = kd.armRot.z; kd.root.position.y = kd.rootY + Math.sin(t * 2 + (s > 0 ? 1 : 0)) * 0.008; }
  }
  // wipers sweep while driving in the rain... or just when asked
  if (T.wipers[0]) { const w = S.wipe ? Math.sin(t * 3) * 0.9 : 0; T.wipers[0].rotation.z = w; T.wipers[1].rotation.z = w; }
  // wheels: spin from the speed, the front pair steers
  S.wheelA += S.speed * dt / 0.52;
  for (const w of T.wheels) w.rotation.x = S.wheelA;
  for (const s of T.steer) if (s) s.rotation.y = S.steer;
  // tools that were tapped: pop out, spin, go home
  for (const tl of T.tools) {
    const k = t - tl.t;
    tl.o.visible = (S.shutterT[tl.shutter] || 0) > 0.02 || k < 4;      // nothing to draw behind a closed shutter
    if (k < 3.6) {
      const out = k < 0.5 ? easeOutBack(k / 0.5) : k > 3.0 ? 1 - (k - 3.0) / 0.6 : 1;
      const sx = Math.sign(tl.home.x) || 1;
      tl.o.position.set(tl.home.x + sx * 1.1 * out, tl.home.y + 0.7 * out, tl.home.z);
      tl.o.rotation.set(tl.homeRot.x, tl.homeRot.y + (k < 3.0 ? k * 2.5 : 0) * out, tl.homeRot.z);
      tl.o.scale.copy(tl.homeScale).multiplyScalar(1 + 0.7 * out);
    } else if (k < 4) { tl.o.position.copy(tl.home); tl.o.rotation.copy(tl.homeRot); tl.o.scale.copy(tl.homeScale); }
  }
  // the bay light sits in the open bay nearest the camera (cheap fill)
}
const easeOutBack = x => 1 + 2.4 * Math.pow(x - 1, 3) + 1.4 * Math.pow(x - 1, 2);
function setEmit(T, name, v) { const m = T.mats[name]; if (m && m.emissiveIntensity !== v) m.emissiveIntensity = v; }

// ---------------------------------------------------------------- helpers for the game
export function nozzleWorld(T, outPos, outDir) {
  T.ladder.tip.getWorldPosition(outPos);
  const q = new THREE.Quaternion(); T.ladder.tip.getWorldQuaternion(q);
  outDir.set(0, 0, 1).applyQuaternion(q).normalize();
}
export function tipWorld(T, out) { return T.ladder.basket.getWorldPosition(out); }

// aim the ladder at a world point: yaw toward it, choose elevation and extension so the tip ends up a few metres off,
// then the nozzle pitch makes the water arc land on the target
export function aimLadder(T, target, mode = 'spray') {
  const S = T.state, L = T.ladder;
  const base = new THREE.Vector3(); L.tt.getWorldPosition(base);
  const inv = new THREE.Matrix4().copy(T.root.matrixWorld).invert();
  const local = target.clone().applyMatrix4(inv); const bl = base.clone().applyMatrix4(inv);
  const dx = local.x - bl.x, dz = local.z - bl.z, dy = local.y - bl.y - 0.9;
  S.yawT = Math.atan2(dx, dz);
  const horiz = Math.hypot(dx, dz);
  if (mode === 'reach') {               // put the tip right at the target (the kitten)
    const dist = Math.hypot(horiz, dy);
    S.elevT = Math.max(0.05, Math.atan2(dy, horiz));
    S.extT = Math.min(1, Math.max(0, (dist - 6.0) / 8.4));
    S.nozPitchT = 0;
  } else {                              // stand off and spray
    const want = Math.max(0, horiz - 4.5);
    S.elevT = Math.max(0.12, Math.min(1.1, Math.atan2(dy + 1.5, Math.max(2, want))));
    S.extT = Math.min(1, Math.max(0, (Math.hypot(want, dy + 1.5) - 6.0) / 8.4));
    S.nozPitchT = 0.25;
  }
}
export function stowLadder(T) { const S = T.state; S.yawT = 0; S.elevT = 0; S.extT = 0; S.nozPitchT = 0; }
export function ladderBusy(T) { const S = T.state; return Math.abs(S.yaw - S.yawT) + Math.abs(S.elev - S.elevT) + Math.abs(S.ext - S.extT) > 0.02; }
