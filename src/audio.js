// Sound: everything is synthesized with WebAudio (siren, horn, bell, engine, water, pops, fanfare),
// plus the narrator's voice clips (decoded from the embedded mp3s). One AudioContext, unlocked on the first tap.
import { VOICES } from './assets.js';

let ctx = null, master = null, voiceBus = null, sfxBus = null;
const buffers = {};
let voiceNode = null, voiceUntil = 0;

export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp); comp.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.gain.value = 0.8; sfxBus.connect(master);
  voiceBus = ctx.createGain(); voiceBus.gain.value = 1.0; voiceBus.connect(master);
  for (const [id, b64] of Object.entries(VOICES)) {
    const bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    ctx.decodeAudioData(u8.buffer).then(buf => { buffers[id] = buf; }).catch(() => {});
  }
}
export const now = () => (ctx ? ctx.currentTime : 0);
export const ready = () => !!ctx;

// ---- the narrator: one line at a time; a new line replaces the old one unless `queue` is set
const queue = [];
export function say(id, { queue: q = false, priority = false } = {}) {
  if (!ctx || !buffers[id]) { if (ctx) setTimeout(() => say(id, { queue: q, priority }), 300); return 0; }
  if (q && voiceNode && ctx.currentTime < voiceUntil) { queue.push(id); return buffers[id].duration; }
  if (voiceNode) { try { voiceNode.stop(); } catch {} }
  const s = ctx.createBufferSource(); s.buffer = buffers[id]; s.connect(voiceBus); s.start();
  voiceNode = s; voiceUntil = ctx.currentTime + buffers[id].duration;
  duck(buffers[id].duration);
  s.onended = () => { if (voiceNode === s) { voiceNode = null; const n = queue.shift(); if (n) say(n); } };
  return buffers[id].duration;
}
export const speaking = () => ctx && ctx.currentTime < voiceUntil;
function duck(d) {
  const t = ctx.currentTime;
  sfxBus.gain.cancelScheduledValues(t); sfxBus.gain.setTargetAtTime(0.38, t, 0.05); sfxBus.gain.setTargetAtTime(0.8, t + d, 0.25);
}

// ---- helpers
function env(g, t, a, peak, d, rel) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d + rel); }
function noiseBuffer(sec = 2) {
  const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
let NB = null;
const nb = () => (NB ||= noiseBuffer(2));

// ---- siren: the rising and falling wail; on/off
let siren = null;
export function sirenOn(on) {
  if (!ctx) return;
  if (on && !siren) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o2.type = 'square'; o2.detune.value = 7;
    o.frequency.value = 900; o2.frequency.value = 900;
    lfo.type = 'triangle'; lfo.frequency.value = 0.42; lg.gain.value = 380;
    lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
    f.type = 'lowpass'; f.frequency.value = 2600; f.Q.value = 2;
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    o.connect(f); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(sfxBus);
    g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.13, ctx.currentTime + 0.4);
    [o, o2, lfo].forEach(x => x.start());
    siren = { o, o2, lfo, g };
  } else if (!on && siren) {
    const s = siren; siren = null;
    s.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.12);
    s.o.frequency.setTargetAtTime(300, ctx.currentTime, 0.4);
    setTimeout(() => [s.o, s.o2, s.lfo].forEach(x => { try { x.stop(); } catch {} }), 900);
  }
}
export const sirenIsOn = () => !!siren;

// ---- air horn: two detuned brassy tones
export function horn(len = 0.55) {
  if (!ctx) return;
  const t = ctx.currentTime, g = ctx.createGain(), f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 1800; f.connect(g); g.connect(sfxBus);
  for (const [fr, v] of [[233, 1], [294, .8], [349, .5]]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr;
    o.frequency.setValueAtTime(fr * 0.94, t); o.frequency.linearRampToValueAtTime(fr, t + 0.06);
    const og = ctx.createGain(); og.gain.value = 0.11 * v; o.connect(og); og.connect(f); o.start(t); o.stop(t + len + 0.2);
  }
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 0.03);
  g.gain.setValueAtTime(1, t + len); g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.15);
}

// ---- bell: inharmonic partials with long decays
export function bell(pitch = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const [r, a, d] of [[1, .5, 1.6], [2.76, .3, .9], [5.4, .18, .5], [8.93, .1, .25], [0.5, .15, 1.8]]) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = 880 * pitch * r;
    o.connect(g); g.connect(sfxBus); env(g, t, 0.003, a * 0.5, 0.01, d); o.start(t); o.stop(t + d + 0.1);
  }
}

// ---- engine: a low rumble whose pitch follows the speed
let engine = null;
export function engineOn(on) {
  if (!ctx) return;
  if (on && !engine) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o2.type = 'square'; o.frequency.value = 42; o2.frequency.value = 21;
    f.type = 'lowpass'; f.frequency.value = 260; f.Q.value = 3;
    const g2 = ctx.createGain(); g2.gain.value = 0.5; o2.connect(g2); g2.connect(f);
    o.connect(f); f.connect(g); g.connect(sfxBus); g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.5);
    o.start(); o2.start(); engine = { o, o2, f, g };
    // starter
    const n = ctx.createBufferSource(); n.buffer = nb(); const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 180;
    const ng = ctx.createGain(); n.connect(nf); nf.connect(ng); ng.connect(sfxBus); env(ng, ctx.currentTime, 0.02, 0.4, 0.5, 0.3); n.start(); n.stop(ctx.currentTime + 1);
  } else if (!on && engine) {
    const e = engine; engine = null; e.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.2);
    setTimeout(() => { try { e.o.stop(); e.o2.stop(); } catch {} }, 1200);
  }
}
export function engineSpeed(v) {           // v: 0..1
  if (!engine) return;
  const t = ctx.currentTime;
  engine.o.frequency.setTargetAtTime(42 + 50 * v, t, 0.15); engine.o2.frequency.setTargetAtTime(21 + 25 * v, t, 0.15);
  engine.f.frequency.setTargetAtTime(260 + 500 * v, t, 0.15); engine.g.gain.setTargetAtTime(0.14 + 0.08 * v, t, 0.2);
}

// ---- water: hissing filtered noise while spraying
let water = null;
export function waterOn(on, strength = 1) {
  if (!ctx) return;
  if (on && !water) {
    const n = ctx.createBufferSource(); n.buffer = nb(); n.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 0.6;
    const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 6000;
    const g = ctx.createGain(); g.gain.value = 0.0001; n.connect(f); f.connect(f2); f2.connect(g); g.connect(sfxBus);
    g.gain.exponentialRampToValueAtTime(0.22 * strength, ctx.currentTime + 0.2); n.start(); water = { n, g };
  } else if (!on && water) {
    const w = water; water = null; w.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.15); setTimeout(() => { try { w.n.stop(); } catch {} }, 900);
  }
}

// ---- short effects
export function pop(p = 1) {
  if (!ctx) return;
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
  o.frequency.setValueAtTime(420 * p, t); o.frequency.exponentialRampToValueAtTime(900 * p, t + 0.08);
  o.connect(g); g.connect(sfxBus); env(g, t, 0.005, 0.3, 0.02, 0.12); o.start(t); o.stop(t + 0.25);
}
export function clunk() {
  if (!ctx) return;
  const t = ctx.currentTime, n = ctx.createBufferSource(); n.buffer = nb();
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; const g = ctx.createGain();
  n.connect(f); f.connect(g); g.connect(sfxBus); env(g, t, 0.004, 0.6, 0.03, 0.15); n.start(t); n.stop(t + 0.3);
  const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = 90; o.connect(og); og.connect(sfxBus); env(og, t, 0.004, 0.3, 0.02, 0.12); o.start(t); o.stop(t + 0.25);
}
export function rattle(dur = 1.0) {          // a roll-up shutter
  if (!ctx) return;
  const t = ctx.currentTime, n = ctx.createBufferSource(); n.buffer = nb();
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3000; f.Q.value = 1.5;
  const am = ctx.createOscillator(), amg = ctx.createGain(); am.frequency.value = 28; amg.gain.value = 0.5; am.connect(amg);
  const g = ctx.createGain(); g.gain.value = 0; amg.connect(g.gain);
  const g2 = ctx.createGain(); n.connect(f); f.connect(g); g.connect(g2); g2.connect(sfxBus);
  g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.35, t + 0.05); g2.gain.setValueAtTime(0.35, t + dur - 0.1); g2.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.start(t); am.start(t); n.stop(t + dur + 0.05); am.stop(t + dur + 0.05);
}
export function whir(dur = 1.2, up = true) {    // hydraulics: ladder, outriggers
  if (!ctx) return;
  const t = ctx.currentTime, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(up ? 110 : 160, t); o.frequency.linearRampToValueAtTime(up ? 160 : 110, t + dur);
  f.type = 'lowpass'; f.frequency.value = 700; o.connect(f); f.connect(g); g.connect(sfxBus);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.1); g.gain.setValueAtTime(0.09, t + dur - 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur + 0.05);
}
export function sparkle() {
  if (!ctx) return;
  const t = ctx.currentTime;
  [0, 4, 7, 12, 16].forEach((s, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = 1046 * Math.pow(2, s / 12);
    o.connect(g); g.connect(sfxBus); env(g, t + i * 0.06, 0.005, 0.18, 0.02, 0.35); o.start(t + i * 0.06); o.stop(t + i * 0.06 + 0.5);
  });
}
export function fanfare() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const notes = [[0, 523], [0.16, 659], [0.32, 784], [0.5, 1046], [0.62, 784], [0.78, 1046]];
  for (const [dt, fr] of notes) {
    for (const [type, v, det] of [['square', 0.06, 0], ['triangle', 0.12, 3]]) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = fr; o.detune.value = det;
      o.connect(g); g.connect(sfxBus); env(g, t + dt, 0.01, v, 0.1, 0.25); o.start(t + dt); o.stop(t + dt + 0.5);
    }
  }
  bell(1.5);
}
export function crackle(level) {            // fire crackle: random pops while a fire burns (call each frame)
  if (!ctx || level <= 0 || Math.random() > level * 0.18) return;
  const t = ctx.currentTime, n = ctx.createBufferSource(); n.buffer = nb();
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1200 + Math.random() * 2000;
  const g = ctx.createGain(); n.connect(f); f.connect(g); g.connect(sfxBus);
  env(g, t, 0.002, 0.05 + 0.08 * Math.random() * level, 0.005, 0.03); n.start(t, Math.random()); n.stop(t + 0.08);
}
export function meow() {
  if (!ctx) return;
  const t = ctx.currentTime, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(520, t); o.frequency.linearRampToValueAtTime(820, t + 0.18); o.frequency.linearRampToValueAtTime(480, t + 0.55);
  f.type = 'bandpass'; f.frequency.setValueAtTime(900, t); f.frequency.linearRampToValueAtTime(1600, t + 0.2); f.frequency.linearRampToValueAtTime(800, t + 0.55); f.Q.value = 4;
  o.connect(f); f.connect(g); g.connect(sfxBus); env(g, t, 0.04, 0.25, 0.3, 0.2); o.start(t); o.stop(t + 0.7);
}
export function setMuted(m) { if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.05); }

// ---- reverse beeper: beep… beep… while backing up
let rev = null;
export function reverseBeep(on) {
  if (!ctx) return;
  if (on && !rev) {
    const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    o.type = 'square'; o.frequency.value = 1150; lfo.type = 'square'; lfo.frequency.value = 2.2; lg.gain.value = 0.045;
    const bias = ctx.createConstantSource(); bias.offset.value = 0.045;
    lfo.connect(lg); lg.connect(g.gain); bias.connect(g.gain); g.gain.value = 0;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3000;
    o.connect(f); f.connect(g); g.connect(sfxBus); o.start(); lfo.start(); bias.start(); rev = { o, lfo, bias, g };
  } else if (!on && rev) { const r = rev; rev = null; [r.o, r.lfo, r.bias].forEach(x => { try { x.stop(); } catch {} }); }
}
// ---- refilling: low bubbling gurgle
let refill = null;
export function refillOn(on) {
  if (!ctx) return;
  if (on && !refill) {
    const n = ctx.createBufferSource(); n.buffer = nb(); n.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 380; f.Q.value = 3;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 7; lg.gain.value = 220; lfo.connect(lg); lg.connect(f.frequency);
    const g = ctx.createGain(); g.gain.value = 0.0001; n.connect(f); f.connect(g); g.connect(sfxBus);
    g.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 0.3); n.start(); lfo.start(); refill = { n, lfo, g };
  } else if (!on && refill) { const r = refill; refill = null; r.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.1); setTimeout(() => { try { r.n.stop(); r.lfo.stop(); } catch {} }, 600); }
}
export function carHorn() {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const [dt, f] of [[0, 520], [0.22, 520]]) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(); o.type = 'square'; o2.type = 'square'; o.frequency.value = f; o2.frequency.value = f * 1.26;
    const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 1800;
    o.connect(fl); o2.connect(fl); fl.connect(g); g.connect(sfxBus); env(g, t + dt, 0.01, 0.12, 0.1, 0.05);
    o.start(t + dt); o2.start(t + dt); o.stop(t + dt + 0.25); o2.stop(t + dt + 0.25);
  }
}
export function bark() {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const dt of [0, 0.28]) {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(380, t + dt); o.frequency.exponentialRampToValueAtTime(240, t + dt + 0.12);
    f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 2; o.connect(f); f.connect(g); g.connect(sfxBus);
    env(g, t + dt, 0.01, 0.35, 0.05, 0.08); o.start(t + dt); o.stop(t + dt + 0.2);
  }
}
export function ding() {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const [dt, f] of [[0, 1318], [0.1, 1760]]) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(sfxBus);
    env(g, t + dt, 0.004, 0.3, 0.02, 0.5); o.start(t + dt); o.stop(t + dt + 0.7);
  }
}
