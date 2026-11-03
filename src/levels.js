// The levels. Each one says how to set up the town, which goals to show (checked off from the engine's events),
// and how fast is three stars. Goals with `ordered` show one at a time; the others can be done in any order.
import * as THREE from 'three';
import { makeRing, makeParkBox, ROAD } from './world.js';
import { START } from './play.js';

const onRoad = (a, r = ROAD.r) => new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);

export const LEVELS = [
  {
    id: 1, name: '认识消防车', icon: '🚒', desc: '点一点，看看消防车有什么', intro: 'l1_intro',
    reset: { start: 'apron', traffic: false }, stars: [999, 999],
    goals: [
      { text: '打开车门', icon: '🚪', voice: 'g_door', done: G => G.flags.door },
      { text: '打开工具箱', icon: '🧰', voice: 'g_tools', done: G => G.flags.tools },
      { text: '点一个工具', icon: '🧯', voice: 'g_tool', done: G => G.flags.tool },
      { text: '打开警灯', icon: '🚨', voice: 'g_lights', done: G => G.flags.lights },
      { text: '敲铃铛', icon: '🔔', voice: 'g_bell', done: G => G.flags.bell },
    ],
  },
  {
    id: 2, name: '出车啦', icon: '🛣️', desc: '沿着光圈开一圈，再开回家', intro: 'l2_intro', ordered: true,
    reset: { start: 'inside', traffic: true }, stars: [80, 130],
    setup(G, L) {
      L.points = [onRoad(-0.25), onRoad(1.15), onRoad(2.6)].map(p => { const r = makeRing(); r.position.copy(p); r.visible = false; G.scene.add(r); return r; });
      L.box = makeParkBox(); L.box.position.copy(START.apron.pos); L.box.visible = false; G.scene.add(L.box);
      L.next = 0;
    },
    tick(G, L, dt) {
      for (const r of L.points) { r.userData.star.rotation.y += dt * 2.5; r.userData.star.position.y = 4.2 + Math.sin(G.t * 3) * 0.3; }
      const cur = L.points[L.next];
      if (G.flags.siren && cur) {
        cur.visible = true;
        if (cur.position.distanceTo(G.truck.pos) < 3.6) { cur.visible = false; L.next++; G.emit('checkpoint'); G.say('checkpoint'); }
      }
      if (L.next >= L.points.length) {
        L.box.visible = !G.flags.parked;
        const p = G.truck.pos;
        if (Math.abs(p.x - L.box.position.x) < 2.2 && Math.abs(p.z - L.box.position.z) < 3.2 && Math.abs(G.truck.speed) < 0.3 && !G.truck.target) G.emit('parked');
      }
    },
    cleanup(G, L) { for (const r of L.points) G.scene.remove(r); G.scene.remove(L.box); },
    goals: [
      { text: '打开警笛', icon: '📢', voice: 'g_siren', done: G => G.flags.siren },
      { text: '开过 3 个光圈', icon: '⭐', voice: null, done: G => (G.flags.checkpoint || 0) >= 3, progress: G => `${Math.min(3, G.flags.checkpoint || 0)}/3` },
      { text: '停进黄色车位', icon: '🅿️', voice: 'g_park', done: G => G.flags.parked },
    ],
  },
  {
    id: 3, name: '小小火苗', icon: '🔥', desc: '房子着火了，快去灭火', intro: 'l3_intro',
    reset: { start: 'apron', traffic: true }, stars: [70, 120],
    setup(G) { setTimeout(() => G.startFire(2, { quiet: true }), 300); },
    goals: [
      { text: '打开警笛', icon: '📢', done: G => G.flags.siren },
      { text: '把火浇灭', icon: '💦', done: G => G.flags.fireOut },
    ],
  },
  {
    id: 4, name: '救小猫', icon: '🐱', desc: '小猫被困在树上了', intro: 'l4_intro',
    reset: { start: 'apron', traffic: false, cat: true }, stars: [60, 110],
    goals: [{ text: '救下小猫', icon: '🐱', done: G => G.flags.catSaved }],
  },
  {
    id: 5, name: '加满水', icon: '💧', desc: '先去消火栓加水，再灭火', intro: 'l5_intro', ordered: true,
    reset: { start: 'apron', traffic: true, tank: 12 }, stars: [100, 160],
    setup(G) { setTimeout(() => G.startFire(1, { quiet: true }), 300); },
    goals: [
      { text: '去消火栓加满水', icon: '💧', done: G => G.flags.refilled },
      { text: '把火浇灭', icon: '💦', done: G => G.flags.fireOut },
    ],
  },
  {
    id: 6, name: '两处着火', icon: '🏘️', desc: '两座房子都着火了', intro: 'l6_intro',
    reset: { start: 'apron', traffic: true, tank: 75 }, stars: [150, 230],
    setup(G) { setTimeout(() => { G.startFire(3, { quiet: true }); G.startFire(4, { quiet: true }); }, 300); },
    goals: [{ text: '扑灭两处大火', icon: '🔥', done: G => (G.flags.fireOut || 0) >= 2, progress: G => `${Math.min(2, G.flags.fireOut || 0)}/2` }],
  },
  {
    id: 7, name: '汽车着火', icon: '🚗', desc: '汽车的火要用泡沫灭', intro: 'l7_intro', ordered: true,
    reset: { start: 'apron', traffic: true }, stars: [90, 150],
    setup(G) { setTimeout(() => G.startFire(G.carFire, { quiet: true }), 300); },
    goals: [
      { text: '换成泡沫', icon: '🧼', done: G => G.flags.foam },
      { text: '扑灭汽车的火', icon: '🚗', done: G => G.flags.fireOut },
    ],
  },
  {
    id: 8, name: '夜间大救援', icon: '🌙', desc: '天黑了，先救小狗再灭火', intro: 'l8_intro', ordered: true,
    reset: { start: 'apron', traffic: false, night: true, dog: true, cat: false, tank: 100 }, stars: [160, 260],
    setup(G) { setTimeout(() => G.startFire(0, { quiet: true }), 300); },
    goals: [
      { text: '救下小狗', icon: '🐶', done: G => G.flags.dogSaved },
      { text: '把火浇灭', icon: '💦', done: G => G.flags.fireOut },
    ],
  },
];
