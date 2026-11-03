// The little town: grass, a ring road, the fire station (with a roll-up door and a sign), houses that can catch fire,
// trees, a hydrant, lamps, a fence, hills, clouds and the sky. Everything here is built in code; the truck comes from Blender.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const STATION = { pos: new THREE.Vector3(0, 0, -30), door: { w: 5.2, h: 4.8 } };
export const ROAD = { r: 17, w: 7.5 };
export const LIMIT = 36;                       // the truck stays inside this radius

const rng = (() => { let s = 12345; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o });

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
function mesh(geo, mat, cast = true, receive = true) { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = receive; return m; }

export function buildWorld(scene) {
  const W = { obstacles: [], houses: [], tappables: [], update: [] };
  const root = new THREE.Group(); scene.add(root); W.root = root;

  // ---- sky: a gradient dome
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color('#5aa9ee') }, mid: { value: new THREE.Color('#bfe3fb') }, bot: { value: new THREE.Color('#eaf6ff') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform vec3 top, mid, bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.15 ? mix(mid, top, smoothstep(0.15, 0.7, h)) : mix(bot, mid, smoothstep(-0.05, 0.15, h)); gl_FragColor = vec4(c, 1.); }',
  }));
  sky.renderOrder = -10; root.add(sky);

  // ---- ground: grass with a soft mottled texture
  const grassTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#86c25a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const x = rng() * w, y = rng() * h, r = 2 + rng() * 9;
      g.fillStyle = rng() < 0.5 ? 'rgba(110,170,70,0.35)' : 'rgba(160,210,100,0.3)';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 90; i++) {            // tiny flowers
      const x = rng() * w, y = rng() * h; g.fillStyle = ['#fff6a8', '#ffffff', '#ffb3c7'][i % 3];
      g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill();
    }
  }, [28, 28]);
  const ground = mesh(new THREE.CircleGeometry(140, 64), new THREE.MeshLambertMaterial({ map: grassTex }), false, true);
  ground.rotation.x = -Math.PI / 2; ground.name = 'Ground'; root.add(ground); W.ground = ground;

  // ---- ring road: asphalt with a dashed centre line and white edges, drawn on a ring texture
  const roadTex = canvasTex(2048, 64, (g, w, h) => {
    g.fillStyle = '#4a4e57'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${rng() < 0.5 ? '255,255,255' : '0,0,0'},0.06)`; g.fillRect(rng() * w, rng() * h, 2, 2); }
    g.fillStyle = '#f2f2ee'; g.fillRect(0, 2, w, 3); g.fillRect(0, h - 5, w, 3);
    g.fillStyle = '#ffd23a'; for (let x = 0; x < w; x += 64) g.fillRect(x, h / 2 - 2, 34, 4);
  });
  roadTex.wrapS = THREE.RepeatWrapping; roadTex.repeat.set(6, 1);
  const ring = new THREE.RingGeometry(ROAD.r - ROAD.w / 2, ROAD.r + ROAD.w / 2, 160, 1);
  // map u around the ring, v across it
  const pos = ring.attributes.position, uv = ring.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), a = Math.atan2(y, x), r = Math.hypot(x, y);
    uv.setXY(i, (a / (Math.PI * 2) + 0.5), (r - (ROAD.r - ROAD.w / 2)) / ROAD.w);
  }
  const road = mesh(ring, new THREE.MeshLambertMaterial({ map: roadTex }), false, true);
  road.rotation.x = -Math.PI / 2; road.position.y = 0.02; root.add(road);
  // the apron: concrete from the station door down to the road, with a yellow "keep clear" box
  const apronTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#c9c6bf'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(0,0,0,${0.03 + rng() * 0.04})`; g.fillRect(rng() * w, rng() * h, 2, 2); }
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 3; for (let y = 0; y < h; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
    g.strokeStyle = '#ffcf1f'; g.lineWidth = 14; g.strokeRect(70, 40, w - 140, h - 80);
    g.lineWidth = 10; for (let k = -6; k < 10; k++) { g.beginPath(); g.moveTo(70 + k * 60, h - 40); g.lineTo(70 + k * 60 + 120, 40); g.stroke(); }
  });
  const apron = mesh(new THREE.PlaneGeometry(11, 12.5), new THREE.MeshLambertMaterial({ map: apronTex }), false, true);
  apron.rotation.x = -Math.PI / 2; apron.position.set(0, 0.025, STATION.pos.z + 9.5); root.add(apron);

  // ---- the fire station
  buildStation(root, W);

  // ---- houses around the ring (each can catch fire at its fire spot)
  const HOUSES = [
    { pos: [24, 0, 4], rot: -Math.PI / 2, wall: '#ffe29a', roof: '#d9534f', w: 7, d: 6, h: 4.2, floors: 2 },
    { pos: [-24, 0, 2], rot: Math.PI / 2, wall: '#bfe3ff', roof: '#3d6fb6', w: 7.5, d: 6, h: 4.6, floors: 2 },
    { pos: [10, 0, 25], rot: Math.PI + 0.35, wall: '#ffc9de', roof: '#8a4fbf', w: 6.5, d: 5.5, h: 3.8, floors: 1 },
    { pos: [-12, 0, 25], rot: Math.PI - 0.4, wall: '#c8f0c0', roof: '#e07b2e', w: 7, d: 6, h: 4.2, floors: 2 },
    { pos: [22, 0, -18], rot: -Math.PI / 2 - 0.6, wall: '#fff3e0', roof: '#2e8b7a', w: 6, d: 5.5, h: 3.8, floors: 1 },
  ];
  HOUSES.forEach((h, i) => W.houses.push(buildHouse(root, W, h, i)));

  // ---- the park in the middle: trees, benches, a big tree with a kitten, flowers
  const treeMats = [std('#4fa83d', { flatShading: true }), std('#3f9a4a', { flatShading: true }), std('#6cbf3f', { flatShading: true })];
  const trunk = std('#8a5a3b');
  function tree(x, z, s = 1, kind = rng() < 0.5 ? 0 : 1) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s);
    g.add(mesh(new THREE.CylinderGeometry(0.22, 0.32, 1.8, 8), trunk).translateY(0.9));
    const m = treeMats[Math.floor(rng() * 3)];
    if (kind === 0) { for (let k = 0; k < 3; k++) g.add(mesh(new THREE.ConeGeometry(1.6 - k * 0.4, 1.8, 8), m).translateY(2.2 + k * 1.0)); }
    else { g.add(mesh(new THREE.IcosahedronGeometry(1.5, 0), m).translateY(2.9)); g.add(mesh(new THREE.IcosahedronGeometry(1.05, 0), m).translateY(3.4).translateX(0.9)); g.add(mesh(new THREE.IcosahedronGeometry(1.0, 0), m).translateY(3.0).translateX(-0.9)); }
    g.rotation.y = rng() * 6; root.add(g);
    W.obstacles.push({ x, z, r: 0.8 * s });
    return g;
  }
  for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2 + 0.3, r = 6 + (i % 2) * 2.5; if (Math.abs(a - Math.PI * 1.5) > 0.5) tree(Math.cos(a) * r, Math.sin(a) * r, 0.85 + rng() * 0.3); }
  // the kitten's tree: bigger, in the park, with a cat on a branch
  const catTree = new THREE.Group(); catTree.position.set(-4, 0, 6); root.add(catTree);
  catTree.add(mesh(new THREE.CylinderGeometry(0.35, 0.55, 5, 10), trunk).translateY(2.5));
  // a long branch reaching out of the leaves, so the kitten sits where everyone can see it
  const br = mesh(new THREE.CylinderGeometry(0.12, 0.24, 3.6, 8), trunk); br.position.set(1.7, 4.55, 0); br.rotation.z = -1.25; catTree.add(br);
  const twig = mesh(new THREE.IcosahedronGeometry(0.45, 0), treeMats[2]); twig.position.set(3.6, 5.25, 0.1); catTree.add(twig);
  for (const [x, y, z, r] of [[-0.3, 6.6, 0, 2.3], [-0.6, 5.7, 1.3, 1.5], [-1.5, 6.0, -0.5, 1.6], [0.1, 7.8, 0.2, 1.5]]) catTree.add(mesh(new THREE.IcosahedronGeometry(r, 1), treeMats[1]).translateX(x).translateY(y).translateZ(z));
  W.obstacles.push({ x: -4, z: 6, r: 1.0 });
  const cat = buildCat(); cat.position.set(3.0, 5.05, 0.05); catTree.add(cat); cat.userData.tap = 'cat';
  W.cat = { group: cat, tree: catTree, saved: false, home: cat.position.clone() };
  W.tappables.push(cat);
  // benches and flower beds
  for (const [x, z, r] of [[3, -3, 0.5], [-6, -2, -0.8]]) {
    const b = new THREE.Group(); b.position.set(x, 0, z); b.rotation.y = r; root.add(b);
    const wood = std('#c98b4c'); b.add(mesh(new THREE.BoxGeometry(1.8, 0.08, 0.5), wood).translateY(0.5)); b.add(mesh(new THREE.BoxGeometry(1.8, 0.4, 0.07), wood).translateY(0.75).translateZ(-0.22));
    for (const sx of [-0.75, 0.75]) b.add(mesh(new THREE.BoxGeometry(0.07, 0.5, 0.45), std('#555')).translateX(sx).translateY(0.25));
  }
  for (let i = 0; i < 40; i++) {
    const a = rng() * Math.PI * 2, r = 2 + rng() * 8.5;
    const f = mesh(new THREE.SphereGeometry(0.12, 6, 4), std(['#ff6b8a', '#ffd93d', '#ffffff', '#a78bfa'][i % 4]), false, false);
    f.position.set(Math.cos(a) * r, 0.12, Math.sin(a) * r); root.add(f);
  }
  // ---- a hydrant by the road (tap it), lamps, cones
  const hyd = buildHydrant(); hyd.position.set(7.5, 0, -12.5); root.add(hyd); W.hydrant = hyd; W.tappables.push(hyd);
  W.obstacles.push({ x: 7.5, z: -12.5, r: 0.5 });
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + 0.2, r = ROAD.r + ROAD.w / 2 + 1.2;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a)) + Math.PI / 2) < 0.35) continue;
    const L = buildLamp(); L.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); root.add(L); W.obstacles.push({ x: L.position.x, z: L.position.z, r: 0.3 });
  }
  // ---- trees, fence and hills outside
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2, r = 30 + rng() * 9;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) < 9 && z < -20) continue;     // keep the station clear
    tree(x, z, 1 + rng() * 0.6);
  }
  const fence = std('#ffffff');
  for (let i = 0; i < 120; i++) {
    const a = i / 120 * Math.PI * 2, r = LIMIT + 4;
    const p = mesh(new THREE.BoxGeometry(0.15, 1.1, 0.15), fence, false, false); p.position.set(Math.cos(a) * r, 0.55, Math.sin(a) * r); root.add(p);
    const rail = mesh(new THREE.BoxGeometry(0.08, 0.12, (2 * Math.PI * r) / 120 + 0.05), fence, false, false);
    rail.position.set(Math.cos(a + Math.PI / 120) * r, 0.8, Math.sin(a + Math.PI / 120) * r); rail.rotation.y = -a - Math.PI / 120; root.add(rail);
  }
  const hillMat = new THREE.MeshLambertMaterial({ color: '#7dbb57', flatShading: true });
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2, r = 85 + rng() * 25;
    const h = mesh(new THREE.SphereGeometry(18 + rng() * 14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), hillMat, false, false);
    h.scale.y = 0.35 + rng() * 0.3; h.position.set(Math.cos(a) * r, -1, Math.sin(a) * r); root.add(h);
  }
  // ---- clouds: puffy groups drifting slowly
  const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.35 });
  const clouds = [];
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Group();
    for (let k = 0; k < 5; k++) c.add(mesh(new THREE.SphereGeometry(3 + rng() * 2.5, 12, 8), cloudMat, false, false).translateX((k - 2) * 3.2).translateY(rng() * 1.5));
    c.position.set((rng() - 0.5) * 220, 38 + rng() * 18, (rng() - 0.5) * 220); c.scale.y = 0.6; root.add(c); clouds.push(c);
  }
  W.update.push(dt => clouds.forEach((c, i) => { c.position.x += dt * (0.6 + i * 0.05); if (c.position.x > 120) c.position.x = -120; }));
  clouds.forEach(c => { c.userData.noMerge = true; });
  [sky, ground, road, apron, W.stationDoor, W.cat.group, W.hydrant].forEach(o => { o.userData.noMerge = true; });
  mergeStatic(root, W);
  return W;
}

// merge every static mesh in the town by material (one draw call per material instead of hundreds)
function mergeStatic(root, W) {
  root.updateMatrixWorld(true);
  const groups = new Map(), drop = [];
  const tapSet = new Set(W.tappables);
  root.traverse(o => {
    if (!o.isMesh || tapSet.has(o)) return;
    for (let p = o; p; p = p.parent) if (p.userData.noMerge) return;
    const key = o.material.uuid + (o.castShadow ? 's' : '') + (o.receiveShadow ? 'r' : '');
    if (!groups.has(key)) groups.set(key, { mat: o.material, cast: o.castShadow, recv: o.receiveShadow, geos: [] });
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(o.matrixWorld);
    groups.get(key).geos.push(g); drop.push(o);
  });
  for (const o of drop) o.parent.remove(o);
  for (const { mat, cast, recv, geos } of groups.values()) {
    const m = new THREE.Mesh(geos.length > 1 ? mergeGeometries(geos, false) : geos[0], mat); m.castShadow = cast; m.receiveShadow = recv; root.add(m);
  }
}

// ---------------------------------------------------------------- the fire station
function buildStation(root, W) {
  const S = new THREE.Group(); S.position.copy(STATION.pos); root.add(S); W.station = S;
  const brickTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#b8473a'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) for (let x = (y / 32) % 2 ? -32 : 0; x < w; x += 64) {
      g.fillStyle = `hsl(${6 + rng() * 6},${48 + rng() * 10}%,${38 + rng() * 10}%)`; g.fillRect(x + 2, y + 2, 60, 28);
    }
  }, [4, 2]);
  const brick = std('#ffffff', { map: brickTex, roughness: 0.9 }), trim = std('#f4f1ea'), dark = std('#3a3d44');
  const WD = 14, D = 12, H = 7.2;
  // walls (front wall has the door opening)
  const back = mesh(new THREE.BoxGeometry(WD, H, 0.4), brick); back.position.set(0, H / 2, -D / 2); S.add(back);
  for (const sx of [-1, 1]) { const s = mesh(new THREE.BoxGeometry(0.4, H, D), brick); s.position.set(sx * WD / 2, H / 2, 0); S.add(s); }
  const dw = STATION.door.w, dh = STATION.door.h;
  for (const sx of [-1, 1]) { const f = mesh(new THREE.BoxGeometry((WD - dw) / 2, H, 0.4), brick); f.position.set(sx * (dw / 2 + (WD - dw) / 4), H / 2, D / 2); S.add(f); }
  const lintel = mesh(new THREE.BoxGeometry(dw, H - dh, 0.4), brick); lintel.position.set(0, dh + (H - dh) / 2, D / 2); S.add(lintel);
  // floor, roof, trims, the tower with the bell, and the sign
  const floor = mesh(new THREE.BoxGeometry(WD, 0.1, D), std('#9a9893')); floor.position.y = 0.05; S.add(floor);
  const roof = mesh(new THREE.BoxGeometry(WD + 0.8, 0.5, D + 0.8), std('#4a4f5a')); roof.position.y = H + 0.25; S.add(roof);
  const cornice = mesh(new THREE.BoxGeometry(WD + 1.0, 0.25, D + 1.0), trim); cornice.position.y = H + 0.05; S.add(cornice);
  for (const sx of [-1, 1]) { const p = mesh(new THREE.BoxGeometry(0.5, dh + 0.3, 0.55), trim); p.position.set(sx * (dw / 2 + 0.25), (dh + 0.3) / 2, D / 2 + 0.05); S.add(p); }
  const head = mesh(new THREE.BoxGeometry(dw + 1.0, 0.45, 0.6), trim); head.position.set(0, dh + 0.22, D / 2 + 0.05); S.add(head);
  const tower = new THREE.Group(); tower.position.set(WD / 2 - 2.2, H, -D / 2 + 2.2); S.add(tower);
  tower.add(mesh(new THREE.BoxGeometry(3, 3.5, 3), brick).translateY(1.75));
  tower.add(mesh(new THREE.ConeGeometry(2.5, 2.2, 4), std('#d9261c')).translateY(4.6).rotateY(Math.PI / 4));
  const tb = mesh(new THREE.SphereGeometry(0.55, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), std('#d9a441', { metalness: 1, roughness: 0.3 }));
  tb.position.y = 2.9; tb.rotation.x = Math.PI; tower.add(tb);
  // the sign: 消防站 with a red badge
  const signTex = canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = '#d9261c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff'; g.fillRect(10, 10, w - 20, h - 20); g.fillStyle = '#d9261c'; g.fillRect(18, 18, w - 36, h - 36);
    g.fillStyle = '#ffffff'; g.font = 'bold 150px "Microsoft YaHei","PingFang SC",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('消 防 站', w / 2 + 50, h / 2 + 8);
    g.font = 'bold 120px sans-serif'; g.fillStyle = '#ffd23a'; g.fillText('🚒', 150, h / 2 + 8);
  });
  const sign = mesh(new THREE.PlaneGeometry(6.4, 1.6), std('#ffffff', { map: signTex, roughness: 0.5 }), false, false);
  sign.position.set(0, dh + 1.35, D / 2 + 0.36); S.add(sign);
  const num = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#ffd23a'; g.beginPath(); g.arc(w / 2, h / 2, 120, 0, 7); g.fill(); g.fillStyle = '#d9261c'; g.font = 'bold 110px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('119', w / 2, h / 2 + 6); });
  const badge = mesh(new THREE.CircleGeometry(0.9, 32), std('#ffffff', { map: num }), false, false); badge.position.set(-WD / 2 + 2.2, H - 1.4, D / 2 + 0.22); S.add(badge);
  // windows on the front
  const glass = std('#9fd3ef', { roughness: 0.1, metalness: 0.2, emissive: '#1d3a4a', emissiveIntensity: 0.4 });
  for (const sx of [-1, 1]) {
    const f = mesh(new THREE.BoxGeometry(2, 1.6, 0.1), trim); f.position.set(sx * 5, 5.4, D / 2 + 0.22); S.add(f);
    const gl = mesh(new THREE.BoxGeometry(1.7, 1.3, 0.1), glass); gl.position.set(sx * 5, 5.4, D / 2 + 0.26); S.add(gl);
  }
  // the roll-up door: slats under a pivot at the top (scaled up when the truck leaves)
  const door = new THREE.Group(); door.position.set(0, dh, D / 2 + 0.05); S.add(door);
  const slat = std('#e8e9ec', { metalness: 0.6, roughness: 0.4 });
  const n = 16; for (let k = 0; k < n; k++) { const s = mesh(new THREE.BoxGeometry(dw, dh / n - 0.03, 0.08), slat); s.position.y = -(k + 0.5) * dh / n; door.add(s); }
  const winTex = std('#2c3e50', { roughness: 0.2 });
  for (let k = 0; k < 4; k++) { const w = mesh(new THREE.BoxGeometry(0.8, 0.35, 0.1), winTex); w.position.set(-1.5 + k, -dh * 0.35, 0.03); door.add(w); }
  door.userData.open = 0; W.stationDoor = door;
  // a lamp inside so the bay glows
  const glowPanel = mesh(new THREE.PlaneGeometry(WD - 1, 1.2), new THREE.MeshBasicMaterial({ color: '#fff3d6' }), false, false); glowPanel.position.set(0, H - 0.8, -D / 2 + 0.25); S.add(glowPanel);
  // collision: the walls (the door gap stays open)
  const z0 = STATION.pos.z;
  W.obstacles.push({ box: [-WD / 2 - 0.5, z0 - D / 2 - 0.5, -dw / 2 + 0.1, z0 + D / 2 + 0.5] }, { box: [dw / 2 - 0.1, z0 - D / 2 - 0.5, WD / 2 + 0.5, z0 + D / 2 + 0.5] }, { box: [-WD / 2, z0 - D / 2 - 0.5, WD / 2, z0 - D / 2 + 0.5] });
  S.userData.tap = 'station'; W.tappables.push(sign);
  sign.userData.tap = 'station';
}

// ---------------------------------------------------------------- a house
function buildHouse(root, W, h, idx) {
  const G = new THREE.Group(); G.position.set(...h.pos); G.rotation.y = h.rot; root.add(G);
  const wall = std(h.wall), roofM = std(h.roof, { flatShading: true }), trim = std('#ffffff'), glass = std('#a9d8f0', { roughness: 0.15, emissive: '#18323f', emissiveIntensity: 0.25 });
  const body = mesh(new THREE.BoxGeometry(h.w, h.h, h.d), wall); body.position.y = h.h / 2; G.add(body);
  // a gable roof (a triangular prism)
  const rs = new THREE.Shape(); rs.moveTo(-h.w / 2 - 0.4, 0); rs.lineTo(h.w / 2 + 0.4, 0); rs.lineTo(0, h.w * 0.42); rs.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(rs, { depth: h.d + 0.6, bevelEnabled: false }); roofGeo.translate(0, 0, -(h.d + 0.6) / 2);
  const roof = mesh(roofGeo, roofM); roof.position.y = h.h; G.add(roof);
  const chim = mesh(new THREE.BoxGeometry(0.7, 1.6, 0.7), std('#b55a48')); chim.position.set(h.w * 0.25, h.h + 1.3, -h.d * 0.15); G.add(chim);
  // door and windows on the front (+z)
  const door = mesh(new THREE.BoxGeometry(1.1, 2.1, 0.12), std('#8a5a3b')); door.position.set(-h.w * 0.22, 1.05, h.d / 2 + 0.03); G.add(door);
  const knob = mesh(new THREE.SphereGeometry(0.06, 8, 6), std('#d9a441', { metalness: 1, roughness: 0.3 })); knob.position.set(-h.w * 0.22 + 0.38, 1.05, h.d / 2 + 0.12); G.add(knob);
  const windows = [];
  const rows = h.floors === 2 ? [1.4, h.h - 1.1] : [1.5];
  for (const y of rows) for (const x of (y === rows[0] ? [h.w * 0.22] : [-h.w * 0.22, h.w * 0.22])) {
    const f = mesh(new THREE.BoxGeometry(1.3, 1.1, 0.1), trim); f.position.set(x, y, h.d / 2 + 0.04); G.add(f);
    const g = mesh(new THREE.BoxGeometry(1.1, 0.9, 0.1), glass.clone()); g.position.set(x, y, h.d / 2 + 0.07); G.add(g);
    const c = mesh(new THREE.BoxGeometry(0.06, 0.9, 0.12), trim); c.position.set(x, y, h.d / 2 + 0.09); G.add(c);
    const box = mesh(new THREE.BoxGeometry(1.3, 0.25, 0.3), std('#8a5a3b')); box.position.set(x, y - 0.65, h.d / 2 + 0.18); G.add(box);
    for (let k = 0; k < 4; k++) { const fl = mesh(new THREE.SphereGeometry(0.1, 6, 4), std(['#ff6b8a', '#ffd93d', '#ff9f43', '#ffffff'][k])); fl.position.set(x - 0.45 + k * 0.3, y - 0.45, h.d / 2 + 0.2); G.add(fl); }
    windows.push(g);
  }
  // a little fence and path
  const path = mesh(new THREE.PlaneGeometry(1.2, 3), std('#d8cbb0'), false, true); path.rotation.x = -Math.PI / 2; path.position.set(-h.w * 0.22, 0.03, h.d / 2 + 1.5); G.add(path);
  // the fire spot: the upstairs window (or the only one), slightly in front of the wall
  const fw = windows[windows.length - 1];
  const fireLocal = fw.position.clone().add(new THREE.Vector3(0, 0.1, 0.25));
  const house = { group: G, windows, fireLocal, fireWorld: new THREE.Vector3(), front: new THREE.Vector3(), burning: false, hp: 0, idx, size: h };
  G.updateMatrixWorld(); house.fireWorld.copy(fireLocal).applyMatrix4(G.matrixWorld);
  house.front.set(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), h.rot);
  // where the truck should park to fight this fire: in front, a few metres out
  house.parkAt = new THREE.Vector3(...h.pos).addScaledVector(house.front, h.d / 2 + 7.5);
  body.userData.tap = 'house'; body.userData.house = house; roof.userData.tap = 'house'; roof.userData.house = house;
  W.tappables.push(body, roof);
  // collision: a circle that covers the footprint
  W.obstacles.push({ x: h.pos[0], z: h.pos[2], r: Math.max(h.w, h.d) * 0.62 });
  return house;
}

function buildHydrant() {
  const g = new THREE.Group(); const red = std('#e2231a', { roughness: 0.4 }), chrome = std('#dfe3e8', { metalness: 1, roughness: 0.2 });
  g.add(mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.12, 16), red).translateY(0.06));
  g.add(mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.85, 16), red).translateY(0.5));
  g.add(mesh(new THREE.SphereGeometry(0.23, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), red).translateY(0.92));
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 8), chrome).translateY(1.18));
  for (const s of [-1, 1]) { const n = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.2, 12), chrome); n.rotation.z = Math.PI / 2; n.position.set(s * 0.3, 0.6, 0); g.add(n); }
  const f = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.18, 12), chrome); f.rotation.x = Math.PI / 2; f.position.set(0, 0.62, 0.28); g.add(f);
  g.children.forEach(c => c.userData.tap = 'hydrant');
  g.userData.tap = 'hydrant';
  return g;
}
function buildLamp() {
  const g = new THREE.Group(), dark = std('#2f3640', { metalness: 0.5, roughness: 0.4 });
  g.add(mesh(new THREE.CylinderGeometry(0.08, 0.12, 4.2, 10), dark).translateY(2.1));
  const arm = mesh(new THREE.BoxGeometry(0.9, 0.08, 0.08), dark); arm.position.set(0.4, 4.15, 0); g.add(arm);
  g.add(mesh(new THREE.ConeGeometry(0.32, 0.35, 12), dark).translateX(0.8).translateY(3.95));
  g.add(mesh(new THREE.SphereGeometry(0.16, 10, 8), std('#fff6d8', { emissive: '#fff1c4', emissiveIntensity: 0.8 }), false, false).translateX(0.8).translateY(3.8));
  return g;
}
function buildCat() {
  const g = new THREE.Group(), fur = std('#ff9f43'), white = std('#ffffff'), eye = std('#1a1a1a');
  const body = mesh(new THREE.SphereGeometry(0.32, 16, 12), fur); body.position.y = 0.3; body.scale.set(1, 0.85, 1.25); g.add(body);
  const head = mesh(new THREE.SphereGeometry(0.24, 16, 12), fur); head.position.set(0, 0.62, 0.3); g.add(head);
  for (const s of [-1, 1]) {
    const ear = mesh(new THREE.ConeGeometry(0.09, 0.18, 4), fur); ear.position.set(s * 0.13, 0.86, 0.28); g.add(ear);
    const e = mesh(new THREE.SphereGeometry(0.04, 8, 6), eye); e.position.set(s * 0.09, 0.66, 0.51); g.add(e);
  }
  const muzzle = mesh(new THREE.SphereGeometry(0.1, 10, 8), white); muzzle.scale.set(1.2, 0.8, 0.8); muzzle.position.set(0, 0.57, 0.5); g.add(muzzle);
  const nose = mesh(new THREE.SphereGeometry(0.03, 8, 6), std('#ff6b8a')); nose.position.set(0, 0.6, 0.57); g.add(nose);
  const tail = mesh(new THREE.TorusGeometry(0.25, 0.05, 6, 16, Math.PI), fur); tail.position.set(0, 0.35, -0.35); tail.rotation.y = Math.PI / 2; g.add(tail);
  g.children.forEach(c => c.userData.tap = 'cat');
  return g;
}
