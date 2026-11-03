"""v2 patch for src/world.js: night sky (stars, moon), a second hydrant, glowing lamps, birds,
the balcony and the puppy on house 0, and helpers (dog, car, ring marker, parking box)."""
import sys
p = sys.argv[1] + '/src/world.js'
s = open(p, encoding='utf-8').read()


def rep(a, b):
    global s
    assert a in s, a[:80]
    s = s.replace(a, b)


rep("""    uniforms: { top: { value: new THREE.Color('#5aa9ee') }, mid: { value: new THREE.Color('#bfe3fb') }, bot: { value: new THREE.Color('#eaf6ff') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform vec3 top, mid, bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.15 ? mix(mid, top, smoothstep(0.15, 0.7, h)) : mix(bot, mid, smoothstep(-0.05, 0.15, h)); gl_FragColor = vec4(c, 1.); }',""",
"""    uniforms: { top: { value: new THREE.Color('#5aa9ee') }, mid: { value: new THREE.Color('#bfe3fb') }, bot: { value: new THREE.Color('#eaf6ff') }, night: { value: 0 } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `uniform vec3 top, mid, bot; uniform float night; varying vec3 vP;
      float h3(vec3 p){ p = fract(p * 0.3183 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main(){
        float h = vP.y;
        vec3 day = h > 0.15 ? mix(mid, top, smoothstep(0.15, 0.7, h)) : mix(bot, mid, smoothstep(-0.05, 0.15, h));
        vec3 sunD = normalize(vec3(-0.45, 0.55, 0.35));
        day += vec3(1.0, 0.9, 0.7) * (pow(max(dot(vP, sunD), 0.), 900.) * 2.0 + pow(max(dot(vP, sunD), 0.), 18.) * 0.18);
        vec3 nt = mix(vec3(0.05, 0.07, 0.16), vec3(0.01, 0.02, 0.07), smoothstep(0.0, 0.6, h));
        vec3 q = floor(vP * 260.); float st = step(0.9965, h3(q)) * smoothstep(0.02, 0.2, h);
        nt += vec3(0.9, 0.95, 1.0) * st * (0.6 + 0.4 * h3(q + 3.1));
        vec3 moonD = normalize(vec3(0.5, 0.45, -0.6));
        nt += vec3(1.0, 0.97, 0.85) * (smoothstep(0.9993, 0.9995, dot(vP, moonD)) + pow(max(dot(vP, moonD), 0.), 60.) * 0.25);
        gl_FragColor = vec4(mix(day, nt, night), 1.);
      }`,""")

rep("""  const hyd = buildHydrant(); hyd.position.set(7.5, 0, -12.5); root.add(hyd); W.hydrant = hyd; W.tappables.push(hyd);
  W.obstacles.push({ x: 7.5, z: -12.5, r: 0.5 });""",
"""  W.hydrants = [];
  for (const [x, z] of [[7.5, -12.5], [-10.8, 6.8]]) {
    const hyd = buildHydrant(); hyd.position.set(x, 0, z); root.add(hyd); W.hydrants.push(hyd); W.tappables.push(...hyd.children);
    hyd.children.forEach(c => { c.userData.hydrant = hyd; });
    W.obstacles.push({ x, z, r: 0.5 });
  }
  W.hydrant = W.hydrants[0];""")

rep("""    const L = buildLamp(); L.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); root.add(L); W.obstacles.push({ x: L.position.x, z: L.position.z, r: 0.3 });""",
"""    const L = buildLamp(); L.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); L.rotation.y = -a + Math.PI; root.add(L); W.obstacles.push({ x: L.position.x, z: L.position.z, r: 0.3 });
    (W.lamps ||= []).push(L);""")

rep("""  clouds.forEach(c => { c.userData.noMerge = true; });""",
"""  clouds.forEach(c => { c.userData.noMerge = true; });
  // ---- birds: little V shapes flapping in slow circles
  const birdMat = new THREE.MeshBasicMaterial({ color: '#3a3f4a', side: THREE.DoubleSide });
  const birds = [];
  for (let i = 0; i < 7; i++) {
    const g = new THREE.Group();
    const wing = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -0.15), new THREE.Vector3(0, 0, 0.2), new THREE.Vector3(0.9, 0, 0)]);
    const l = new THREE.Mesh(wing, birdMat), r = new THREE.Mesh(wing, birdMat); r.scale.x = -1; g.add(l, r);
    g.userData = { noMerge: true, l, r, a: rng() * 6.28, rad: 18 + rng() * 22, h: 16 + rng() * 10, sp: 0.12 + rng() * 0.08, ph: rng() * 6 };
    root.add(g); birds.push(g);
  }
  W.update.push(dt => birds.forEach(b => {
    const u = b.userData; u.a += u.sp * dt; u.ph += dt * 9;
    b.position.set(Math.cos(u.a) * u.rad, u.h + Math.sin(u.a * 3) * 1.2, Math.sin(u.a) * u.rad); b.rotation.y = -u.a;
    const f = Math.sin(u.ph) * 0.6; u.l.rotation.z = f; u.r.rotation.z = -f;
  }));
  // ---- night: dark sky with stars and a moon, warm windows, glowing lamps
  const glowTex = canvasTex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(64, 64, 2, 64, 64, 62); gr.addColorStop(0, 'rgba(255,230,170,1)'); gr.addColorStop(0.35, 'rgba(255,200,120,0.45)'); gr.addColorStop(1, 'rgba(255,190,110,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const glows = [];
  for (const L of W.lamps) {
    L.userData.noMerge = true;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sp.scale.setScalar(4); sp.position.set(0.8, 3.7, 0); sp.visible = false; L.add(sp); glows.push(sp);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(3.2, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.55 }));
    pool.position.set(0.8, 0.05, 0); pool.visible = false; L.add(pool); glows.push(pool);
  }
  W.night = 0;
  W.setNight = on => {
    W.night = on ? 1 : 0;
    sky.material.uniforms.night.value = W.night;
    glows.forEach(g => { g.visible = on; });
    W.lamps.forEach(L => L.traverse(o => { if (o.material && o.material.emissive && o.userData.bulb) o.material.emissiveIntensity = on ? 3.5 : 0.8; }));
    for (const h of W.houses) if (!h.burning) h.windows.forEach(w => { w.material.emissive.set(on ? '#ffc56a' : '#18323f'); w.material.emissiveIntensity = on ? 0.9 : 0.25; });
    if (W.stationGlow) W.stationGlow.material.color.set(on ? '#ffe2a8' : '#fff3d6');
    clouds.forEach(c => { c.visible = !on; });
    birds.forEach(b => { b.visible = !on; });
  };""")

rep("""  const glowPanel = mesh(new THREE.PlaneGeometry(WD - 1, 1.2), new THREE.MeshBasicMaterial({ color: '#fff3d6' }), false, false); glowPanel.position.set(0, H - 0.8, -D / 2 + 0.25); S.add(glowPanel);""",
"""  const glowPanel = mesh(new THREE.PlaneGeometry(WD - 1, 1.2), new THREE.MeshBasicMaterial({ color: '#fff3d6' }), false, false); glowPanel.position.set(0, H - 0.8, -D / 2 + 0.25); S.add(glowPanel);
  glowPanel.userData.noMerge = true; W.stationGlow = glowPanel;""")

rep("""  g.add(mesh(new THREE.SphereGeometry(0.16, 10, 8), std('#fff6d8', { emissive: '#fff1c4', emissiveIntensity: 0.8 }), false, false).translateX(0.8).translateY(3.8));""",
"""  const bulb = mesh(new THREE.SphereGeometry(0.16, 10, 8), std('#fff6d8', { emissive: '#fff1c4', emissiveIntensity: 0.8 }), false, false); bulb.userData.bulb = true;
  g.add(bulb.translateX(0.8).translateY(3.8));""")

rep("""  // a little fence and path""",
"""  // house 0 has a balcony under its upstairs left window: the puppy waits there in the night level
  if (idx === 0) {
    const bx = -h.w * 0.22, by = h.h - 1.75;
    const slab = mesh(new THREE.BoxGeometry(1.9, 0.14, 1.15), std('#e8e2d6')); slab.position.set(bx, by, h.d / 2 + 0.57); G.add(slab);
    const rail = std('#ffffff');
    for (let k = 0; k <= 6; k++) { const p = mesh(new THREE.BoxGeometry(0.06, 0.75, 0.06), rail); p.position.set(bx - 0.9 + k * 0.3, by + 0.44, h.d / 2 + 1.1); G.add(p); }
    for (const sx of [-1, 1]) { const p = mesh(new THREE.BoxGeometry(0.06, 0.75, 0.06), rail); p.position.set(bx + sx * 0.92, by + 0.44, h.d / 2 + 0.6); G.add(p); }
    const top = mesh(new THREE.BoxGeometry(1.95, 0.08, 0.08), rail); top.position.set(bx, by + 0.82, h.d / 2 + 1.1); G.add(top);
    for (const sx of [-1, 1]) { const t = mesh(new THREE.BoxGeometry(0.08, 0.08, 1.1), rail); t.position.set(bx + sx * 0.95, by + 0.82, h.d / 2 + 0.57); G.add(t); }
    const dog = buildDog(); dog.position.set(bx, by + 0.08, h.d / 2 + 0.55); G.add(dog); dog.visible = false; dog.userData.noMerge = true;
    W.dog = { group: dog, house: null, home: dog.position.clone(), homeParent: G };
    W.tappables.push(...dog.children);
  }
  // a little fence and path""")

rep("""  const house = { group: G, windows, fireLocal, fireWorld: new THREE.Vector3(), front: new THREE.Vector3(), burning: false, hp: 0, idx, size: h };""",
"""  const house = { group: G, windows, fireLocal, fireWorld: new THREE.Vector3(), front: new THREE.Vector3(), burning: false, hp: 0, idx, size: h };
  if (idx === 0 && W.dog) W.dog.house = house;""")

# the cat is a rescue too: keep its parent for resets
rep("""  W.cat = { group: cat, tree: catTree, saved: false, home: cat.position.clone() };""",
    """  W.cat = { group: cat, tree: catTree, saved: false, home: cat.position.clone(), homeParent: catTree };""")

s += r"""
export function buildDog() {
  const g = new THREE.Group(), fur = std('#f3e3c8'), ear = std('#a8714a'), eye = std('#1a1a1a'), red = std('#e8392c');
  const body = mesh(new THREE.SphereGeometry(0.3, 16, 12), fur); body.scale.set(0.9, 0.8, 1.3); body.position.y = 0.32; g.add(body);
  const head = mesh(new THREE.SphereGeometry(0.24, 16, 12), fur); head.position.set(0, 0.62, 0.32); g.add(head);
  const snout = mesh(new THREE.SphereGeometry(0.11, 12, 8), fur); snout.scale.set(1, 0.8, 1.2); snout.position.set(0, 0.56, 0.52); g.add(snout);
  const nose = mesh(new THREE.SphereGeometry(0.04, 8, 6), eye); nose.position.set(0, 0.6, 0.64); g.add(nose);
  for (const sx of [-1, 1]) {
    const e = mesh(new THREE.SphereGeometry(0.035, 8, 6), eye); e.position.set(sx * 0.09, 0.7, 0.5); g.add(e);
    const ea = mesh(new THREE.SphereGeometry(0.1, 10, 8), ear); ea.scale.set(0.5, 1.2, 0.8); ea.position.set(sx * 0.2, 0.62, 0.28); ea.rotation.z = sx * 0.4; g.add(ea);
    for (const z of [0.2, -0.2]) { const l = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.25, 8), fur); l.position.set(sx * 0.14, 0.12, z); g.add(l); }
  }
  const collar = mesh(new THREE.TorusGeometry(0.17, 0.035, 6, 16), red); collar.position.set(0, 0.5, 0.25); collar.rotation.x = Math.PI / 2.4; g.add(collar);
  const tail = mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.3, 6), fur); tail.position.set(0, 0.5, -0.38); tail.rotation.x = -0.8; g.add(tail);
  g.userData.tail = tail;
  g.children.forEach(c => { c.userData.tap = 'dog'; });
  return g;
}

// a little low-poly car: body, cabin with windows, wheels, lights
export function buildCar(color = '#3b82f6') {
  const g = new THREE.Group();
  const paint = std(color, { roughness: 0.35, metalness: 0.1 }), glass = std('#9fd3ef', { roughness: 0.1, metalness: 0.3 }), black = std('#222428');
  const light = std('#fff6d0', { emissive: '#fff2c0', emissiveIntensity: 0.6 }), tail = std('#d92020', { emissive: '#ff2010', emissiveIntensity: 0.4 }), chrome = std('#dfe3e8', { metalness: 1, roughness: 0.25 });
  const add = (geo, m, x, y, z) => { const o = mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
  add(new THREE.BoxGeometry(1.7, 0.55, 3.6), paint, 0, 0.62, 0);
  add(new THREE.BoxGeometry(1.5, 0.5, 1.9), paint, 0, 1.12, -0.2);
  add(new THREE.BoxGeometry(1.52, 0.38, 1.7), glass, 0, 1.12, -0.2);
  add(new THREE.BoxGeometry(1.72, 0.14, 0.2), chrome, 0, 0.45, 1.8); add(new THREE.BoxGeometry(1.72, 0.14, 0.2), chrome, 0, 0.45, -1.8);
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.32, 0.14, 0.05), light, sx * 0.6, 0.72, 1.81);
    add(new THREE.BoxGeometry(0.32, 0.12, 0.05), tail, sx * 0.6, 0.72, -1.81);
    for (const z of [1.15, -1.15]) { const w = add(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 16), black, sx * 0.82, 0.34, z); w.rotation.z = Math.PI / 2; }
  }
  g.children.forEach(c => { c.userData.tap = 'car'; });
  return g;
}
// a glowing ring with a spinning star: a checkpoint on the road
export function makeRing(color = '#ffd23a') {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.18, 10, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.25; g.add(ring);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 6, 32, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  beam.position.y = 3; g.add(beam);
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), new THREE.MeshStandardMaterial({ color: '#ffd23a', emissive: '#ffb300', emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.3 }));
  star.position.y = 4.2; g.add(star); g.userData.star = star;
  return g;
}
// a yellow parking box painted on the ground
export function makeParkBox() {
  const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: '#ffd23a', transparent: true, opacity: 0.95 });
  for (const [w, d, x, z] of [[3.6, 0.25, 0, 5], [3.6, 0.25, 0, -5], [0.25, 10.2, 1.8, 0], [0.25, 10.2, -1.8, 0]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), m); b.position.set(x, 0.06, z); g.add(b); }
  const p = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 9.8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd23a', transparent: true, opacity: 0.18, depthWrite: false })); p.position.y = 0.05; g.add(p);
  return g;
}
"""
open(p, 'w', encoding='utf-8').write(s)
print('world.js patched')
