// Sheep: passive wandering mobs. The relay designates one client the
// simulation host — it runs the AI against its local voxel world and
// broadcasts positions; everyone else interpolates. Punching a sheep sends a
// hit to the host, which applies knockback. Mobs are ambient life only:
// they are NOT recorded on-chain (only world edits are).

import * as THREE from 'three';

const SHEEP_COUNT = 6;
const WANDER_SPEED = 1.3;

function buildSheep() {
  const g = new THREE.Group();
  const wool = new THREE.MeshLambertMaterial({ color: 0xe8e6e1 });
  const face = new THREE.MeshLambertMaterial({ color: 0xcfa38a });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.62, 1.25), wool);
  body.position.y = 0.72;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), face);
  head.position.set(0, 0.95, 0.75);
  const legMat = new THREE.MeshLambertMaterial({ color: 0xbdb9b0 });
  const legs = [];
  for (const [lx, lz] of [[-0.28, 0.42], [0.28, 0.42], [-0.28, -0.42], [0.28, -0.42]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.42, 0.18), legMat);
    leg.position.set(lx, 0.21, lz);
    legs.push(leg);
  }
  g.add(body, head, ...legs);
  g.userData.wool = wool;
  return g;
}

export class Mobs {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.isHost = false;
    this.mobs = new Map(); // id -> { group, target {x,y,z,yaw}, sim {...} (host only) }
    this.sendState = null; // set by main.js: (list) => relay
    this.accum = 0;
  }

  becomeHost() {
    if (this.isHost) return;
    this.isHost = true;
    if (this.mobs.size === 0) this.spawnAll();
  }

  spawnAll() {
    for (let i = 0; i < SHEEP_COUNT; i++) {
      const x = Math.floor((Math.random() - 0.5) * 70);
      const z = Math.floor((Math.random() - 0.5) * 70);
      const y = this.world.surfaceHeight(x, z) + 1;
      this.ensure(i, x + 0.5, y, z + 0.5, 0);
      const m = this.mobs.get(i);
      m.sim = { vx: 0, vz: 0, tx: x, tz: z, think: 0, hurtT: 0, kx: 0, kz: 0 };
    }
  }

  ensure(id, x, y, z, yaw) {
    let m = this.mobs.get(id);
    if (!m) {
      const group = buildSheep();
      group.position.set(x, y, z);
      this.scene.add(group);
      m = { group, target: { x, y, z, yaw } };
      this.mobs.set(id, m);
    }
    m.target = { x, y, z, yaw };
    return m;
  }

  // remote state from the host (non-host clients)
  applyState(list) {
    if (this.isHost) return;
    for (const s of list) {
      const m = this.ensure(s.id, s.x, s.y, s.z, s.yaw);
      m.group.userData.wool.color.setHex(s.hurt ? 0xe89090 : 0xe8e6e1);
    }
  }

  // a player punched mob `id` from direction (ix, iz) — host applies knockback
  applyHit(id, ix, iz) {
    const m = this.mobs.get(id);
    if (!m || !m.sim) return;
    m.sim.kx += ix * 7;
    m.sim.kz += iz * 7;
    m.sim.hurtT = 0.5;
  }

  // find a mob within reach of a ray (origin, dir); returns id or null
  raycastMob(origin, dir, maxDist = 4) {
    let best = null, bestT = maxDist;
    for (const [id, m] of this.mobs) {
      const to = m.group.position.clone().add(new THREE.Vector3(0, 0.7, 0)).sub(origin);
      const t = to.dot(dir);
      if (t < 0 || t > bestT) continue;
      const closest = origin.clone().addScaledVector(dir, t);
      if (closest.distanceTo(m.group.position.clone().add(new THREE.Vector3(0, 0.7, 0))) < 0.85) {
        best = id;
        bestT = t;
      }
    }
    return best;
  }

  simulate(dt) {
    for (const [, m] of this.mobs) {
      const s = m.sim;
      if (!s) continue;
      const g = m.group;
      s.think -= dt;
      s.hurtT = Math.max(0, s.hurtT - dt);
      if (s.think <= 0) {
        s.think = 4 + Math.random() * 8;
        s.tx = Math.max(-54, Math.min(54, g.position.x + (Math.random() - 0.5) * 24));
        s.tz = Math.max(-54, Math.min(54, g.position.z + (Math.random() - 0.5) * 24));
      }
      const dx = s.tx - g.position.x, dz = s.tz - g.position.z;
      const d = Math.hypot(dx, dz);
      let vx = 0, vz = 0;
      if (d > 0.8) {
        vx = (dx / d) * WANDER_SPEED;
        vz = (dz / d) * WANDER_SPEED;
      }
      vx += s.kx; vz += s.kz;
      s.kx *= 1 - Math.min(1, dt * 4);
      s.kz *= 1 - Math.min(1, dt * 4);

      const nx = g.position.x + vx * dt;
      const nz = g.position.z + vz * dt;
      const groundY = this.world.surfaceHeight(Math.floor(nx), Math.floor(nz)) + 1;
      // don't walk into water or up cliffs > 1 block
      const isWater = this.world.getBlock(Math.floor(nx), groundY - 1, Math.floor(nz)) === 8;
      if (!isWater && groundY - g.position.y < 1.6) {
        g.position.x = nx;
        g.position.z = nz;
        g.position.y += (groundY - g.position.y) * Math.min(1, dt * 10);
        if (Math.hypot(vx, vz) > 0.2) g.rotation.y = Math.atan2(vx, vz);
      } else {
        s.think = 0; // blocked: pick a new target
      }
      g.userData.wool.color.setHex(s.hurtT > 0 ? 0xe89090 : 0xe8e6e1);
    }

    // broadcast at ~6 Hz
    this.accum += dt;
    if (this.accum > 0.16 && this.sendState) {
      this.accum = 0;
      this.sendState([...this.mobs.entries()].map(([id, m]) => ({
        id,
        x: +m.group.position.x.toFixed(2),
        y: +m.group.position.y.toFixed(2),
        z: +m.group.position.z.toFixed(2),
        yaw: +m.group.rotation.y.toFixed(2),
        hurt: m.sim && m.sim.hurtT > 0 ? 1 : 0,
      })));
    }
  }

  update(dt) {
    if (this.isHost) {
      this.simulate(dt);
      return;
    }
    const k = Math.min(1, dt * 10);
    for (const [, m] of this.mobs) {
      const g = m.group, t = m.target;
      g.position.x += (t.x - g.position.x) * k;
      g.position.y += (t.y - g.position.y) * k;
      g.position.z += (t.z - g.position.z) * k;
      let dy = t.yaw - g.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      g.rotation.y += dy * k;
    }
  }

  get count() {
    return this.mobs.size;
  }
}
