// Little cars driving round the ring road. They brake for anything in front of them (the truck, another car,
// a burning car) and, when the fire truck's siren is on and it comes close, they pull over to the kerb and wait.
import * as THREE from 'three';
import { buildCar, ROAD } from './world.js';

const LANE = ROAD.r + 1.8, KERB = ROAD.r + 3.4;

export class Traffic {
  constructor(scene, n = 4) {
    this.cars = [];
    const colors = ['#3b82f6', '#f5b800', '#22a35a', '#ef5da8', '#8b5cf6'];
    for (let i = 0; i < n; i++) {
      const g = buildCar(colors[i % colors.length]); scene.add(g);
      this.cars.push({ g, a: i / n * Math.PI * 2 + 0.4, r: LANE, v: 0, vmax: 3.6 + i * 0.3, pullUntil: 0, pos: new THREE.Vector3() });
    }
    this.enabled = true; this.yielded = false;
    this.place(0);
  }
  setEnabled(on) { this.enabled = on; for (const c of this.cars) c.g.visible = on; }
  place() { for (const c of this.cars) { c.pos.set(Math.cos(c.a) * c.r, 0, Math.sin(c.a) * c.r); c.g.position.copy(c.pos); c.g.rotation.y = -c.a; } }
  // obstacles for the truck's collision
  // obstacles for the truck: only cars still in the lane (a car at the kerb is out of the way)
  obstacles() { return this.enabled ? this.cars.filter(c => c.r < LANE + 0.8).map(c => ({ x: c.pos.x, z: c.pos.z, r: 1.4 })) : []; }
  update(dt, t, truck, sirenOn, blockers = []) {
    if (!this.enabled) return false;
    let newlyYielded = false;
    for (const c of this.cars) {
      // forward direction along the ring (counter-clockwise: angle increases)
      const fx = -Math.sin(c.a), fz = Math.cos(c.a);
      const dTruck = Math.hypot(truck.pos.x - c.pos.x, truck.pos.z - c.pos.z);
      if (sirenOn && dTruck < 24 && c.pullUntil < t) { c.pullUntil = t + 6; newlyYielded = true; }
      if (dTruck < 9) c.pullUntil = Math.max(c.pullUntil, t + 3);          // always make room for the fire truck
      const pulling = c.pullUntil > t;
      // anything ahead in our lane? (the truck, other cars, a burning car)
      let ahead = false;
      const check = (x, z, rad) => {
        const dx = x - c.pos.x, dz = z - c.pos.z, along = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
        if (along > 0 && along < 7 + rad && side < 2.2 + rad * 0.5) ahead = true;
      };
      check(truck.pos.x, truck.pos.z, 3);
      check(truck.pos.x + Math.sin(truck.heading) * 3.5, truck.pos.z + Math.cos(truck.heading) * 3.5, 1);
      check(truck.pos.x - Math.sin(truck.heading) * 3.5, truck.pos.z - Math.cos(truck.heading) * 3.5, 1);
      for (const o of this.cars) if (o !== c) check(o.pos.x, o.pos.z, 1);
      for (const b of blockers) check(b.x, b.z, b.r || 1.5);
      const want = pulling ? (Math.abs(c.r - KERB) > 0.2 ? 1.6 : 0) : (ahead ? 0 : c.vmax);
      c.v += THREE.MathUtils.clamp(want - c.v, -6 * dt, 2.5 * dt);
      c.r += THREE.MathUtils.clamp((pulling ? KERB : LANE) - c.r, -1.2 * dt, 1.2 * dt);
      c.a += c.v / c.r * dt;
      c.pos.set(Math.cos(c.a) * c.r, 0, Math.sin(c.a) * c.r);
      c.g.position.copy(c.pos);
      const steer = (pulling ? KERB : LANE) - c.r;
      c.g.rotation.y = -c.a - steer * 0.25;
    }
    return newlyYielded;
  }
}
