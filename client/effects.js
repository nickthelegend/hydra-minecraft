// Game feel: block-break particle debris, mining crack overlay (4 stages),
// and procedural WebAudio sounds (no asset files).

import * as THREE from 'three';
import { BLOCKS } from './world.js';

// ---- particles --------------------------------------------------------------

const MAX_PARTICLES = 240;

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.geometry = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    this.pool = [];
    this.active = [];
  }

  obtain(colorHex) {
    let p = this.pool.pop();
    if (!p) {
      if (this.active.length >= MAX_PARTICLES) return null;
      p = new THREE.Mesh(this.geometry, new THREE.MeshLambertMaterial());
      p.material.transparent = true;
    }
    p.material.color.setHex(colorHex);
    p.material.opacity = 1;
    return p;
  }

  burst(x, y, z, blockId, count = 18) {
    const base = BLOCKS[blockId]?.color ?? 0x888888;
    for (let i = 0; i < count; i++) {
      const p = this.obtain(base);
      if (!p) return;
      p.material.color.multiplyScalar(0.75 + Math.random() * 0.5);
      p.position.set(x + Math.random(), y + Math.random(), z + Math.random());
      p.userData.vel = new THREE.Vector3(
        (Math.random() - 0.5) * 4.5,
        Math.random() * 4.5 + 1,
        (Math.random() - 0.5) * 4.5
      );
      p.userData.life = 0.55 + Math.random() * 0.3;
      p.userData.t = 0;
      const s = 0.6 + Math.random() * 0.9;
      p.scale.set(s, s, s);
      this.scene.add(p);
      this.active.push(p);
    }
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.userData.t += dt;
      const k = p.userData.t / p.userData.life;
      if (k >= 1) {
        this.scene.remove(p);
        this.active.splice(i, 1);
        this.pool.push(p);
        continue;
      }
      p.userData.vel.y -= 13 * dt;
      p.position.addScaledVector(p.userData.vel, dt);
      p.material.opacity = 1 - k * k;
      p.rotation.x += dt * 6;
      p.rotation.y += dt * 5;
    }
  }
}

// ---- mining crack overlay ----------------------------------------------------

function crackTexture(stage) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(15,15,15,0.9)';
  ctx.lineWidth = 2.2;
  const rand = (() => { let s = 7 + stage * 13; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const cracks = 3 + stage * 3;
  for (let i = 0; i < cracks; i++) {
    ctx.beginPath();
    let x = 32 + (rand() - 0.5) * 14, y = 32 + (rand() - 0.5) * 14;
    ctx.moveTo(x, y);
    const segs = 2 + Math.floor(rand() * 3);
    for (let s = 0; s < segs; s++) {
      x += (rand() - 0.5) * (18 + stage * 8);
      y += (rand() - 0.5) * (18 + stage * 8);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

export class CrackOverlay {
  constructor(scene) {
    this.materials = [0, 1, 2, 3].map((s) =>
      new THREE.MeshBasicMaterial({
        map: crackTexture(s),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      })
    );
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1.003, 1.003, 1.003), this.materials[0]);
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  show(x, y, z, progress01) {
    const stage = Math.min(3, Math.floor(progress01 * 4));
    this.mesh.material = this.materials[stage];
    this.mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.mesh.visible = true;
  }

  hide() {
    this.mesh.visible = false;
  }
}

// ---- procedural sounds ---------------------------------------------------------

export class Sounds {
  constructor() {
    this.ctx = null;
    this.volume = 0.35;
  }

  ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  noiseBuffer(ctx, seconds = 0.25) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // filtered noise burst; character depends on the block material
  break_(blockId) {
    const ctx = this.ensure();
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, 0.22);
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    const glassy = blockId === 6;
    const stony = blockId === 2 || blockId === 7;
    filter.type = 'bandpass';
    filter.frequency.value = glassy ? 2600 : stony ? 420 : blockId === 4 ? 850 : 680;
    filter.Q.value = glassy ? 6 : 1.4;
    gain.gain.setValueAtTime(this.volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + (glassy ? 0.3 : 0.2));
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t);
  }

  place() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(210, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.09);
    gain.gain.setValueAtTime(this.volume * 0.9, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  }

  mineTick(progress01) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 300 + progress01 * 260;
    gain.gain.setValueAtTime(this.volume * 0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  jump() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(520, t + 0.09);
    gain.gain.setValueAtTime(this.volume * 0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.11);
  }

  splash() {
    const ctx = this.ensure();
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, 0.35);
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    gain.gain.setValueAtTime(this.volume * 0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t);
  }

  explosion() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, 1.1);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1600, t);
    filter.frequency.exponentialRampToValueAtTime(60, t + 0.9);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.volume * 1.6, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t);
    const boom = ctx.createOscillator();
    const bg = ctx.createGain();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(90, t);
    boom.frequency.exponentialRampToValueAtTime(28, t + 0.7);
    bg.gain.setValueAtTime(this.volume * 1.2, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
    boom.connect(bg).connect(ctx.destination);
    boom.start(t);
    boom.stop(t + 0.8);
  }

  fuse() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 1500;
    gain.gain.setValueAtTime(this.volume * 0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.09);
  }

  hurt() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.16);
    gain.gain.setValueAtTime(this.volume * 0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.19);
  }

  bleat() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(420, t);
    for (let i = 0; i < 6; i++) osc.frequency.setValueAtTime(i % 2 ? 380 : 440, t + i * 0.05);
    gain.gain.setValueAtTime(this.volume * 0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.33);
  }

  footstep(blockId) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, 0.07);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    const stony = blockId === 2 || blockId === 7;
    filter.frequency.value = stony ? 700 : blockId === 3 ? 400 : 260;
    filter.Q.value = 1.1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.volume * (stony ? 0.16 : 0.12), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t);
  }

  chirp() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const f = 2400 + Math.random() * 900;
      osc.frequency.setValueAtTime(f, t + i * 0.14);
      osc.frequency.exponentialRampToValueAtTime(f * 1.3, t + i * 0.14 + 0.08);
      gain.gain.setValueAtTime(0, t + i * 0.14);
      gain.gain.linearRampToValueAtTime(this.volume * 0.1, t + i * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.14 + 0.11);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + i * 0.14);
      osc.stop(t + i * 0.14 + 0.12);
    }
  }

  groan() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.linearRampToValueAtTime(70, t + 0.55);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(this.volume * 0.3, t + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    osc.connect(filter).connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.62);
  }

  // gentle looping wind bed; call once, then setWind(0..1)
  startWind() {
    const ctx = this.ensure();
    if (!ctx || this.windGain) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, 2.5);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = this.volume * 0.05;
    src.connect(filter).connect(this.windGain).connect(ctx.destination);
    src.start();
  }
}
