// Effects: water (jet droplets, splashes, puddles), fire (shader flames, embers, smoke, a flickering light),
// steam when water hits fire, confetti and stars, exhaust puffs. Everything is instanced or pooled.
import * as THREE from 'three';

const G = new THREE.Vector3(0, -9.8, 0);
const tmp = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpM = new THREE.Matrix4(), tmpS = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0), ROLL = new THREE.Quaternion(), ZAX = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3();

function softSprite(color = '#ffffff', inner = 1) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, color); gr.addColorStop(0.45 * inner, color.replace('1)', '0.55)')); gr.addColorStop(1, color.replace('1)', '0)'));
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------- water
export class Water {
  constructor(scene, n = 900, { color = '#cfeeff', size = 0.075, emissive = '#4aa3d8', opacity = 0.82 } = {}) {
    this.n = n; this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.life = new Float32Array(n); this.i = 0;
    const geo = new THREE.SphereGeometry(size, 8, 6);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.05, metalness: 0.1, transparent: true, opacity, emissive, emissiveIntensity: 0.25 });
    this.mesh = new THREE.InstancedMesh(geo, mat, n); this.mesh.frustumCulled = false; this.mesh.count = n;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    // splashes: little rings on the ground
    this.splash = new Splashes(scene);
    this.mist = new Puffs(scene, 220, softSprite('rgba(230,245,255,1)'), { additive: false, opacity: 0.55 });
    this.hits = [];                 // world points where water landed this frame (for fires)
    for (let i = 0; i < n; i++) this.life[i] = 0;
    this.carry = 0;
  }
  emit(origin, dir, rate, dt, speed = 15, spread = 0.035) {
    this.carry += rate * dt;
    while (this.carry >= 1) {
      this.carry -= 1;
      const i = this.i = (this.i + 1) % this.n;
      const jx = (Math.random() - 0.5) * spread, jy = (Math.random() - 0.5) * spread, jz = (Math.random() - 0.5) * spread;
      const s = speed * (0.92 + Math.random() * 0.12);
      this.v[i * 3] = (dir.x + jx) * s; this.v[i * 3 + 1] = (dir.y + jy) * s; this.v[i * 3 + 2] = (dir.z + jz) * s;
      const back = Math.random() * dt;           // spread the spawn along the frame
      this.p[i * 3] = origin.x + this.v[i * 3] * back; this.p[i * 3 + 1] = origin.y + this.v[i * 3 + 1] * back; this.p[i * 3 + 2] = origin.z + this.v[i * 3 + 2] * back;
      this.life[i] = 3.5;
      if (Math.random() < 0.15) this.mist.add(origin, tmp.set(this.v[i * 3], this.v[i * 3 + 1], this.v[i * 3 + 2]).multiplyScalar(0.3), 0.3, 0.9);
    }
  }
  update(dt, colliders) {
    this.hits.length = 0;
    this.splash.update(dt); this.mist.update(dt);
    let alive = 0; for (let i = 0; i < this.n; i++) if (this.life[i] > 0) alive++;
    if (!alive && !this.wasAlive) return;
    this.wasAlive = alive;
    const p = this.p, v = this.v;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.mesh.setMatrixAt(i, ZERO); continue; }
      this.life[i] -= dt;
      v[i * 3 + 1] += G.y * dt;
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
      tmp.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      let dead = false;
      for (const c of colliders) {                // fires and the kitten: spheres the water can hit
        if (c.active && tmp.distanceToSquared(c.pos) < c.r * c.r) { this.hits.push(c); dead = true; if (Math.random() < 0.25) this.mist.add(tmp, new THREE.Vector3(0, 1.5, 0), 0.6, 1.4); break; }
      }
      if (!dead && p[i * 3 + 1] < 0.03) { dead = true; if (Math.random() < 0.35) this.splash.add(tmp.setY(0.04)); }
      if (dead) { this.life[i] = 0; this.mesh.setMatrixAt(i, ZERO); continue; }
      // stretch along the velocity
      tmpS.set(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]); const sp = tmpS.length();
      tmpQ.setFromUnitVectors(UP, tmpS.multiplyScalar(1 / Math.max(sp, 1e-3)));
      tmpM.compose(tmp, tmpQ, ONE.set(1, 1 + sp * 0.08, 1));
      this.mesh.setMatrixAt(i, tmpM);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

class Splashes {
  constructor(scene, n = 160) {
    this.n = n; this.i = 0; this.items = [];
    const geo = new THREE.RingGeometry(0.06, 0.12, 20); geo.rotateX(-Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({ color: '#e8f7ff', transparent: true, opacity: 0.7, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, n); this.mesh.frustumCulled = false; scene.add(this.mesh);
    for (let i = 0; i < n; i++) { this.items.push({ p: new THREE.Vector3(), t: 9 }); this.mesh.setMatrixAt(i, tmpM.makeScale(0, 0, 0)); }
    // a puddle that grows under the water
    this.puddles = [];
    this.pmat = new THREE.MeshStandardMaterial({ color: '#7fa9c4', roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.5, depthWrite: false });
    this.scene = scene;
  }
  add(p) {
    const it = this.items[this.i = (this.i + 1) % this.n]; it.p.copy(p); it.t = 0;
    // puddles: grow the nearest one, or start a new one
    let best = null; for (const q of this.puddles) if (q.position.distanceTo(p) < 1.6) { best = q; break; }
    if (!best && this.puddles.length < 30) {
      best = new THREE.Mesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), this.pmat); best.position.copy(p).setY(0.035); best.scale.setScalar(0.1); best.renderOrder = 1; this.scene.add(best); this.puddles.push(best);
    }
    if (best && best.scale.x < 1.7) best.scale.multiplyScalar(1.004);
  }
  update(dt) {
    let alive = 0; for (const it of this.items) { it.t += dt; if (it.t <= 0.5) alive++; }
    if (!alive && !this.wasAlive) return; this.wasAlive = alive;
    for (let i = 0; i < this.n; i++) {
      const it = this.items[i];
      if (it.t > 0.5) { this.mesh.setMatrixAt(i, ZERO); continue; }
      const s = 1 + it.t * 6; tmpM.compose(it.p, tmpQ.identity(), tmpS.set(s, 1, s)); this.mesh.setMatrixAt(i, tmpM);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- billboard puffs (smoke, steam, mist, exhaust)
export class Puffs {
  constructor(scene, n, tex, { additive = false, opacity = 0.6, color = '#ffffff' } = {}) {
    this.n = n; this.i = 0; this.items = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    this.mat = new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, n); this.mesh.frustumCulled = false; this.mesh.renderOrder = 5; scene.add(this.mesh);
    const col = new THREE.Color(1, 1, 1); for (let i = 0; i < n; i++) { this.items.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), t: 9, life: 1, s0: 1, s1: 2 }); this.mesh.setMatrixAt(i, tmpM.makeScale(0, 0, 0)); this.mesh.setColorAt(i, col); }
    this.cam = null;
  }
  add(p, v, s0 = 0.5, s1 = 2, life = 1.5, color) {
    const it = this.items[this.i = (this.i + 1) % this.n];
    it.p.copy(p); it.v.copy(v); it.t = 0; it.life = life; it.s0 = s0; it.s1 = s1; it.rot = Math.random() * 6;
    if (color) this.mesh.setColorAt(this.i, color), (this.mesh.instanceColor.needsUpdate = true);
  }
  update(dt, cam = this.cam) {
    if (!cam) return;
    let alive = 0; for (const it of this.items) { it.t += dt; if (it.t <= it.life) alive++; }
    if (!alive && !this.wasAlive) return; this.wasAlive = alive;
    for (let i = 0; i < this.n; i++) {
      const it = this.items[i];
      if (it.t > it.life) { this.mesh.setMatrixAt(i, ZERO); continue; }
      it.p.addScaledVector(it.v, dt); it.v.multiplyScalar(1 - 0.6 * dt);
      const k = it.t / it.life, s = it.s0 + (it.s1 - it.s0) * k;
      const fade = Math.min(1, k * 6) * (1 - k);
      tmpQ.copy(cam.quaternion).multiply(ROLL.setFromAxisAngle(ZAX, it.rot + k));
      tmpM.compose(it.p, tmpQ, tmpS.set(s * fade + 0.001, s * fade + 0.001, 1));
      this.mesh.setMatrixAt(i, tmpM);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- fire: shader flames on crossed billboards
const flameMat = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.NormalBlending, side: THREE.DoubleSide,
  uniforms: { uT: { value: 0 }, uHP: { value: 1 }, uSeed: { value: Math.random() * 10 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: `
    uniform float uT, uHP, uSeed; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
    float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a*n(p); p *= 2.03; a *= .5; } return s; }
    void main(){
      vec2 uv = vUv; float y = uv.y;
      float w = fbm(vec2(uv.x*3. + uSeed, y*2.6 - uT*2.4));
      float shape = 1. - smoothstep(0., .5, abs(uv.x - .5 + (w - .5)*.35*y) * (1.2 + y*1.6));
      float body = shape * smoothstep(1., .15, y + (w - .5)*.55) * smoothstep(0., .08, y);
      body = pow(clamp(body * 1.6, 0., 1.), 1.3) * uHP;
      vec3 col = mix(vec3(.95, .18, .02), vec3(1., .62, .08), smoothstep(.25, .8, body));
      col = mix(col, vec3(1., .93, .55), smoothstep(.88, 1., body));
      gl_FragColor = vec4(col * 1.15, clamp(body * 1.25, 0., 1.));
    }`,
});

export class Fire {
  constructor(scene, pos, scale = 1) {
    this.group = new THREE.Group(); this.group.position.copy(pos); scene.add(this.group);
    this.pos = pos.clone(); this.scale = scale; this.hp = 0; this.active = false; this.r = 1.8 * scale;
    this.flames = [];
    for (let k = 0; k < 5; k++) {
      const m = flameMat(); const s = (k === 0 ? 2.4 : 1.4 + Math.random() * 0.8) * scale;
      const f = new THREE.Mesh(new THREE.PlaneGeometry(s * 0.8, s * 1.4), m);
      f.position.set((k === 0 ? 0 : (Math.random() - 0.5) * 1.6) * scale, s * 0.55, (Math.random() - 0.5) * 0.6);
      f.userData.base = f.position.clone(); f.userData.s = s; this.group.add(f); this.flames.push(f);
    }
    if (!Fire.light) { Fire.light = new THREE.PointLight('#ff7a22', 0, 16, 1.6); scene.add(Fire.light); }
    this.light = Fire.light;
    this.smoke = null; this.embers = null; this.t = 0; this.group.visible = false;
  }
  start() { this.hp = 1; this.active = true; this.group.visible = true; }
  stop() { this.active = false; }
  update(dt, cam, smoke, embers, steam) {
    this.t += dt;
    if (!this.active && this.hp <= 0) { if (this.group.visible) { this.group.visible = false; this.light.intensity = 0; } return; }
    if (!this.active) this.hp = Math.max(0, this.hp - dt * 0.8);
    const vis = this.hp;
    for (const f of this.flames) {
      f.material.uniforms.uT.value = this.t; f.material.uniforms.uHP.value = Math.min(1, vis * 1.2);
      f.quaternion.copy(cam.quaternion);              // billboard
      const sc = 0.25 + 0.75 * vis; f.scale.setScalar(sc); f.position.y = f.userData.base.y * sc;
    }
    this.light.position.copy(this.pos).add(new THREE.Vector3(0, 1.5, 0.8));
    this.light.intensity = (18 + Math.sin(this.t * 17) * 4 + Math.sin(this.t * 7.3) * 5) * vis * this.scale;
    // smoke from the top, embers drifting up
    if (vis > 0.05 && Math.random() < 0.5 * vis) {
      tmp.copy(this.pos).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 2.2 * this.scale, (Math.random() - 0.5) * 0.6));
      smoke.add(tmp, new THREE.Vector3((Math.random() - 0.5) * 0.4 + 0.3, 1.6 + Math.random(), 0), 0.8, 3.2 + vis * 2, 3.5, new THREE.Color().setHSL(0, 0, 0.25 + 0.3 * (1 - vis)));
    }
    if (vis > 0.1 && Math.random() < 0.6 * vis) {
      tmp.copy(this.pos).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.6, (Math.random() - 0.5) * 0.6));
      embers.add(tmp, new THREE.Vector3((Math.random() - 0.5) * 1.2, 2 + Math.random() * 2, (Math.random() - 0.5) * 1.2), 0.12, 0.04, 1.3);
    }
  }
  douse(amount, steam, agent = 'water') {   // water or foam hit: lose hp, puff steam; an oil fire only yields to foam
    if (!this.active) return false;
    if (this.oil && agent !== 'foam') { this.hp = Math.min(1, this.hp + amount * 0.15); this.wrongAgent = (this.wrongAgent || 0) + 1; return false; }
    this.hp = Math.max(0, this.hp - amount);
    if (Math.random() < 0.4) steam.add(this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.4, 1 + Math.random(), 0.5)), new THREE.Vector3(0, 2.2, 0), 0.6, 2.6, 1.6);
    if (this.hp <= 0) { this.active = false; return true; }
    return false;
  }
}

// ---------------------------------------------------------------- confetti and stars (celebration)
export class Confetti {
  constructor(scene, n = 400) {
    this.n = n; this.items = []; this.i = 0;
    const geo = new THREE.PlaneGeometry(0.16, 0.1);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, n); this.mesh.frustumCulled = false; scene.add(this.mesh);
    const cols = ['#ff4d4d', '#ffd23a', '#4dabff', '#5ee07a', '#ff8ad8', '#ffffff', '#ff9f1a'].map(c => new THREE.Color(c));
    for (let i = 0; i < n; i++) { this.items.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), t: 9 }); this.mesh.setColorAt(i, cols[i % cols.length]); this.mesh.setMatrixAt(i, tmpM.makeScale(0, 0, 0)); }
  }
  burst(p, count = 220) {
    for (let k = 0; k < count; k++) {
      const it = this.items[this.i = (this.i + 1) % this.n]; it.p.copy(p);
      const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 6;
      it.v.set(Math.cos(a) * s * 0.6, 6 + Math.random() * 7, Math.sin(a) * s * 0.6); it.t = 0;
      it.w.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
    }
  }
  update(dt) {
    let alive = 0; for (const it of this.items) { it.t += dt; if (it.t <= 4.5) alive++; }
    if (!alive && !this.wasAlive) return; this.wasAlive = alive;
    for (let i = 0; i < this.n; i++) {
      const it = this.items[i];
      if (it.t > 4.5 || it.p.y < 0.02 && it.t > 0.3) { it.t = Math.max(it.t, 4.6); this.mesh.setMatrixAt(i, ZERO); continue; }
      it.v.y -= 6 * dt; it.v.multiplyScalar(1 - 1.4 * dt); it.v.y = Math.max(it.v.y, -2.2);
      it.p.addScaledVector(it.v, dt); it.r.x += it.w.x * dt; it.r.y += it.w.y * dt; it.r.z += it.w.z * dt;
      tmpM.compose(it.p, tmpQ.setFromEuler(it.r), tmpS.set(1, 1, 1)); this.mesh.setMatrixAt(i, tmpM);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export function makeFx(scene) {
  const smoke = new Puffs(scene, 260, softSprite('rgba(90,90,95,1)'), { opacity: 0.55 });
  const steam = new Puffs(scene, 200, softSprite('rgba(255,255,255,1)'), { opacity: 0.6 });
  const embers = new Puffs(scene, 200, softSprite('rgba(255,180,60,1)', 0.4), { additive: true, opacity: 1 });
  const exhaust = new Puffs(scene, 80, softSprite('rgba(120,120,125,1)'), { opacity: 0.35 });
  const sparkles = new Puffs(scene, 120, softSprite('rgba(255,240,150,1)', 0.3), { additive: true, opacity: 1 });
  const water = new Water(scene);
  const foam = new Water(scene, 700, { color: '#ffffff', size: 0.13, emissive: '#cfd8e0', opacity: 0.92 });
  const confetti = new Confetti(scene);
  const jet = new Stream(scene);
  const foamJet = new Stream(scene, { color: '#ffffff', r0: 0.12, r1: 0.5, opacity: 0.9, emissive: '#c8d2da' });
  return { smoke, steam, embers, exhaust, sparkles, water, foam, confetti, jet, foamJet, puffs: [smoke, steam, embers, exhaust, sparkles] };
}

// ---------------------------------------------------------------- the jet: a tube along the ballistic arc with flowing streaks
export class Stream {
  constructor(scene, { color = '#d6f1ff', r0 = 0.07, r1 = 0.32, opacity = 0.75, emissive = '#5fb4e6' } = {}) {
    this.N = 56; this.R = 10; this.r0 = r0; this.r1 = r1;
    const n = this.N * (this.R + 1);
    this.pos = new Float32Array(n * 3); this.uv = new Float32Array(n * 2); this.col = new Float32Array(n * 4);
    const idx = [];
    for (let i = 0; i < this.N - 1; i++) for (let j = 0; j < this.R; j++) {
      const a = i * (this.R + 1) + j, b = a + this.R + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx); g.computeBoundingSphere();
    const c = document.createElement('canvas'); c.width = 64; c.height = 256; const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 64, 256);
    for (let k = 0; k < 60; k++) { x.fillStyle = `rgba(150,190,220,${0.15 + Math.random() * 0.3})`; x.fillRect(Math.random() * 64, Math.random() * 256, 2 + Math.random() * 6, 10 + Math.random() * 40); }
    this.tex = new THREE.CanvasTexture(c); this.tex.wrapS = this.tex.wrapT = THREE.RepeatWrapping; this.tex.repeat.set(2, 3);
    this.mat = new THREE.MeshStandardMaterial({ color, map: this.tex, transparent: true, opacity, vertexColors: true, roughness: 0.15, metalness: 0.0, emissive, emissiveIntensity: 0.25, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 4;
    scene.add(this.mesh); this.t = 0; this.end = new THREE.Vector3();
  }
  // origin, dir (unit), speed; colliders: [{pos, r, active}] stop the jet; returns the end point
  update(dt, on, origin, dir, speed, colliders = []) {
    this.t += dt;
    if (!on) { this.mesh.visible = false; return null; }
    this.mesh.visible = true;
    this.tex.offset.y -= dt * 3.2;
    const pts = [], step = 0.045;
    const p = origin.clone(), v = dir.clone().multiplyScalar(speed);
    let hit = false;
    for (let i = 0; i < this.N; i++) {
      pts.push(p.clone());
      if (p.y < 0.02 || hit) break;
      v.y -= 9.8 * step; p.addScaledVector(v, step);
      for (const c of colliders) if (c.active && p.distanceToSquared(c.pos) < c.r * c.r * 0.5) { hit = true; break; }
    }
    while (pts.length < this.N) pts.push(pts[pts.length - 1].clone());
    this.end.copy(pts[pts.length - 1]);
    const up = new THREE.Vector3(), side = new THREE.Vector3(), tng = new THREE.Vector3();
    let real = pts.findIndex((q, i) => i > 0 && q.equals(pts[i - 1])); if (real < 0) real = this.N;
    for (let i = 0; i < this.N; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(this.N - 1, i + 1)];
      tng.subVectors(b, a); if (tng.lengthSq() < 1e-8) tng.copy(dir); tng.normalize();
      side.crossVectors(tng, Math.abs(tng.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
      up.crossVectors(side, tng).normalize();
      const k = Math.min(1, i / Math.max(1, real - 1));
      const wob = 1 + 0.12 * Math.sin(this.t * 23 + i * 0.9);
      const rad = (this.r0 + (this.r1 - this.r0) * Math.pow(k, 0.8)) * wob;
      const alpha = i >= real ? 0 : (1 - Math.pow(k, 3) * 0.75);
      for (let j = 0; j <= this.R; j++) {
        const th = j / this.R * Math.PI * 2, o = (i * (this.R + 1) + j);
        const px = pts[i].x + (side.x * Math.cos(th) + up.x * Math.sin(th)) * rad;
        const py = pts[i].y + (side.y * Math.cos(th) + up.y * Math.sin(th)) * rad;
        const pz = pts[i].z + (side.z * Math.cos(th) + up.z * Math.sin(th)) * rad;
        this.pos[o * 3] = px; this.pos[o * 3 + 1] = py; this.pos[o * 3 + 2] = pz;
        this.uv[o * 2] = j / this.R; this.uv[o * 2 + 1] = i / this.N * 4;
        this.col[o * 4] = 1; this.col[o * 4 + 1] = 1; this.col[o * 4 + 2] = 1; this.col[o * 4 + 3] = alpha;
      }
    }
    const g = this.mesh.geometry; g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.uv.needsUpdate = true;
    return this.end;
  }
}

// a sooty mark on a wall after a fire
export function scorch(scene, pos, normal, size = 2.2) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 70, 4, 64, 64, 62); gr.addColorStop(0, 'rgba(20,18,16,0.85)'); gr.addColorStop(0.6, 'rgba(30,26,22,0.45)'); gr.addColorStop(1, 'rgba(30,26,22,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 1.4), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  m.position.copy(pos).addScaledVector(normal, 0.08); m.position.y += size * 0.35;
  m.lookAt(m.position.clone().add(normal)); scene.add(m);
  return m;
}
