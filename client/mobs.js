// Mobs: passive sheep/pigs/cows/chickens plus hostile zombies that spawn at
// night, chase players and despawn at dawn. The relay designates one client
// the simulation host — it runs all AI against its local voxel world and
// broadcasts state; everyone else interpolates. Punches route to the host,
// which applies knockback and damage; dead mobs poof. Mobs are ambient life:
// they are NOT recorded on-chain (only world edits are).

import * as THREE from 'three';

const PASSIVE_COUNT = 8;
const MAX_ZOMBIES = 6;

function box(w, h, d, color) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
}

function quadLegs(g, color, height = 0.42, spread = [0.28, 0.42]) {
  for (const [lx, lz] of [[-spread[0], spread[1]], [spread[0], spread[1]], [-spread[0], -spread[1]], [spread[0], -spread[1]]]) {
    const leg = box(0.16, height, 0.16, color);
    leg.position.set(lx, height / 2, lz);
    g.add(leg);
  }
}

const MOB_TYPES = {
  sheep: {
    hp: 3, speed: 1.3, hostile: false,
    build() {
      const g = new THREE.Group();
      const body = box(0.9, 0.62, 1.25, 0xe8e6e1); body.position.y = 0.72;
      const head = box(0.42, 0.42, 0.42, 0xcfa38a); head.position.set(0, 0.95, 0.75);
      quadLegs(g, 0xbdb9b0);
      g.add(body, head);
      g.userData.tint = [body.material];
      return g;
    },
  },
  pig: {
    hp: 3, speed: 1.2, hostile: false,
    build() {
      const g = new THREE.Group();
      const body = box(0.85, 0.55, 1.2, 0xefa2a8); body.position.y = 0.58;
      const head = box(0.45, 0.42, 0.4, 0xf0b0b5); head.position.set(0, 0.68, 0.72);
      const snout = box(0.2, 0.12, 0.08, 0xd97f88); snout.position.set(0, 0.62, 0.95);
      quadLegs(g, 0xd98f96, 0.32, [0.26, 0.4]);
      g.add(body, head, snout);
      g.userData.tint = [body.material, head.material];
      return g;
    },
  },
  cow: {
    hp: 4, speed: 1.1, hostile: false,
    build() {
      const g = new THREE.Group();
      const body = box(0.95, 0.68, 1.35, 0x5c4030); body.position.y = 0.78;
      const patch = box(0.97, 0.3, 0.6, 0xece7dd); patch.position.set(0, 0.85, -0.2);
      const head = box(0.45, 0.45, 0.42, 0x6b4c39); head.position.set(0, 1.05, 0.82);
      const horns = box(0.62, 0.08, 0.08, 0xd8d3c4); horns.position.set(0, 1.28, 0.8);
      quadLegs(g, 0x4a3527, 0.45, [0.3, 0.46]);
      g.add(body, patch, head, horns);
      g.userData.tint = [body.material, head.material];
      return g;
    },
  },
  chicken: {
    hp: 2, speed: 1.7, hostile: false,
    build() {
      const g = new THREE.Group();
      const body = box(0.42, 0.42, 0.55, 0xf5f2ea); body.position.y = 0.5;
      const head = box(0.24, 0.3, 0.22, 0xf5f2ea); head.position.set(0, 0.85, 0.3);
      const beak = box(0.12, 0.08, 0.12, 0xe8a33d); beak.position.set(0, 0.82, 0.45);
      const comb = box(0.08, 0.1, 0.12, 0xd9453a); comb.position.set(0, 1.02, 0.3);
      const legs = box(0.06, 0.3, 0.06, 0xe8a33d); legs.position.set(-0.08, 0.15, 0);
      const legs2 = legs.clone(); legs2.position.x = 0.08;
      g.add(body, head, beak, comb, legs, legs2);
      g.userData.tint = [body.material];
      return g;
    },
  },
  zombie: {
    hp: 5, speed: 2.3, hostile: true,
    build() {
      const g = new THREE.Group();
      const legs = box(0.5, 0.68, 0.26, 0x2e4a8f); legs.position.y = 0.34;
      const body = box(0.55, 0.75, 0.28, 0x3e7a3a); body.position.y = 1.05;
      const head = box(0.48, 0.48, 0.48, 0x6aa85e); head.position.y = 1.68;
      const armL = box(0.16, 0.16, 0.7, 0x4d8a47); armL.position.set(-0.36, 1.32, 0.3);
      const armR = armL.clone(); armR.position.x = 0.36;
      g.add(legs, body, head, armL, armR);
      g.userData.tint = [body.material, head.material];
      return g;
    },
  },
};
const PASSIVE_KINDS = ['sheep', 'sheep', 'sheep', 'pig', 'pig', 'cow', 'cow', 'chicken'];

export class Mobs {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.isHost = false;
    this.mobs = new Map(); // id -> { type, group, target, baseColors, sim? }
    this.sendState = null; // (list) => relay
    this.onPoof = null; // (x, y, z) => particles
    this.zombieSeq = 100;
    this.accum = 0;
  }

  becomeHost() {
    if (this.isHost) return;
    this.isHost = true;
    if (this.mobs.size === 0) this.spawnPassive();
  }

  randomLandSpot(nearX = 0, nearZ = 0, minR = 0, maxR = 38) {
    for (let tries = 0; tries < 24; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = minR + Math.random() * (maxR - minR);
      const x = Math.max(-54, Math.min(54, Math.round(nearX + Math.cos(a) * r)));
      const z = Math.max(-54, Math.min(54, Math.round(nearZ + Math.sin(a) * r)));
      const y = this.world.surfaceHeight(x, z);
      if (this.world.getBlock(x, y, z) !== 8 && y > 20) return [x + 0.5, y + 1, z + 0.5];
    }
    return null;
  }

  spawnPassive() {
    PASSIVE_KINDS.forEach((kind, i) => {
      const spot = this.randomLandSpot();
      if (!spot) return;
      const m = this.ensure(i, kind, spot[0], spot[1], spot[2], 0);
      m.sim = this.freshSim(kind);
    });
  }

  freshSim(kind) {
    return { hp: MOB_TYPES[kind].hp, vx: 0, vz: 0, tx: 0, tz: 0, think: 0, hurtT: 0, kx: 0, kz: 0 };
  }

  ensure(id, type, x, y, z, yaw) {
    let m = this.mobs.get(id);
    if (!m) {
      const group = MOB_TYPES[type].build();
      group.position.set(x, y, z);
      this.scene.add(group);
      m = { type, group, target: { x, y, z, yaw } };
      m.baseColors = group.userData.tint.map((mat) => mat.color.getHex());
      this.mobs.set(id, m);
    }
    m.target = { x, y, z, yaw };
    return m;
  }

  remove(id, poof = true) {
    const m = this.mobs.get(id);
    if (!m) return;
    if (poof) this.onPoof?.(m.group.position.x, m.group.position.y + 0.6, m.group.position.z);
    this.scene.remove(m.group);
    this.mobs.delete(id);
  }

  setHurtTint(m, hurt) {
    m.group.userData.tint.forEach((mat, i) => {
      mat.color.setHex(hurt ? 0xe06060 : m.baseColors[i]);
    });
  }

  // remote state from the host (non-host clients)
  applyState(list) {
    if (this.isHost) return;
    const seen = new Set();
    for (const s of list) {
      if (!MOB_TYPES[s.t]) continue;
      seen.add(s.id);
      const m = this.ensure(s.id, s.t, s.x, s.y, s.z, s.yaw);
      this.setHurtTint(m, !!s.hurt);
    }
    for (const id of [...this.mobs.keys()]) {
      if (!seen.has(id)) this.remove(id, true); // died or despawned on the host
    }
  }

  // a player punched mob `id` from direction (ix, iz) — host applies it
  applyHit(id, ix, iz) {
    const m = this.mobs.get(id);
    if (!m || !m.sim) return;
    m.sim.kx += ix * 7;
    m.sim.kz += iz * 7;
    m.sim.hurtT = 0.5;
    m.sim.hp -= 1;
    if (m.sim.hp <= 0) this.remove(id, true);
  }

  raycastMob(origin, dir, maxDist = 4) {
    let best = null, bestT = maxDist;
    for (const [id, m] of this.mobs) {
      const to = m.group.position.clone().add(new THREE.Vector3(0, 0.7, 0)).sub(origin);
      const t = to.dot(dir);
      if (t < 0 || t > bestT) continue;
      const closest = origin.clone().addScaledVector(dir, t);
      if (closest.distanceTo(m.group.position.clone().add(new THREE.Vector3(0, 0.7, 0))) < 0.9) {
        best = id;
        bestT = t;
      }
    }
    return best;
  }

  // hostile zombies: spawn after dark away from players, despawn at dawn
  manageZombies(daylight, players) {
    const zombies = [...this.mobs.entries()].filter(([, m]) => m.type === 'zombie');
    if (daylight < 0.12) {
      if (zombies.length < MAX_ZOMBIES && Math.random() < 0.02) {
        const near = players[0] || { x: 0, z: 0 };
        const spot = this.randomLandSpot(near.x, near.z, 14, 34);
        if (spot) {
          const id = this.zombieSeq++;
          const m = this.ensure(id, 'zombie', spot[0], spot[1], spot[2], 0);
          m.sim = this.freshSim('zombie');
        }
      }
    } else if (daylight > 0.22) {
      for (const [id] of zombies) this.remove(id, true); // dawn: poof
    }
  }

  simulate(dt, daylight, players) {
    this.manageZombies(daylight, players);

    for (const [, m] of this.mobs) {
      const s = m.sim;
      if (!s) continue;
      const g = m.group;
      const spec = MOB_TYPES[m.type];
      s.think -= dt;
      s.hurtT = Math.max(0, s.hurtT - dt);

      let vx = 0, vz = 0;
      let chasing = false;
      if (spec.hostile && players.length) {
        let nearest = null, nd = 24;
        for (const p of players) {
          const d = Math.hypot(p.x - g.position.x, p.z - g.position.z);
          if (d < nd) { nd = d; nearest = p; }
        }
        if (nearest && nd > 0.7) {
          chasing = true;
          vx = ((nearest.x - g.position.x) / nd) * spec.speed;
          vz = ((nearest.z - g.position.z) / nd) * spec.speed;
        }
      }
      if (!chasing) {
        if (s.think <= 0) {
          s.think = 4 + Math.random() * 8;
          s.tx = Math.max(-54, Math.min(54, g.position.x + (Math.random() - 0.5) * 24));
          s.tz = Math.max(-54, Math.min(54, g.position.z + (Math.random() - 0.5) * 24));
        }
        const dx = s.tx - g.position.x, dz = s.tz - g.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.8) {
          const wanderSpeed = spec.hostile ? 1.0 : spec.speed;
          vx = (dx / d) * wanderSpeed;
          vz = (dz / d) * wanderSpeed;
        }
      }
      vx += s.kx; vz += s.kz;
      s.kx *= 1 - Math.min(1, dt * 4);
      s.kz *= 1 - Math.min(1, dt * 4);

      const nx = g.position.x + vx * dt;
      const nz = g.position.z + vz * dt;
      const groundY = this.world.surfaceHeight(Math.floor(nx), Math.floor(nz)) + 1;
      const isWater = this.world.getBlock(Math.floor(nx), groundY - 1, Math.floor(nz)) === 8;
      if (!isWater && groundY - g.position.y < 1.6) {
        g.position.x = nx;
        g.position.z = nz;
        g.position.y += (groundY - g.position.y) * Math.min(1, dt * 10);
        if (Math.hypot(vx, vz) > 0.2) g.rotation.y = Math.atan2(vx, vz);
      } else if (!chasing) {
        s.think = 0; // blocked: pick a new wander target
      }
      this.setHurtTint(m, s.hurtT > 0);
    }

    this.accum += dt;
    if (this.accum > 0.16 && this.sendState) {
      this.accum = 0;
      this.sendState([...this.mobs.entries()].map(([id, m]) => ({
        id,
        t: m.type,
        x: +m.group.position.x.toFixed(2),
        y: +m.group.position.y.toFixed(2),
        z: +m.group.position.z.toFixed(2),
        yaw: +m.group.rotation.y.toFixed(2),
        hurt: m.sim && m.sim.hurtT > 0 ? 1 : 0,
      })));
    }
  }

  update(dt, daylight = 1, players = []) {
    if (this.isHost) {
      this.simulate(dt, daylight, players);
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

  // zombies close enough to bite the local player
  hostileTouching(pos, radius = 1.35) {
    const out = [];
    for (const [id, m] of this.mobs) {
      if (!MOB_TYPES[m.type].hostile) continue;
      const d = Math.hypot(m.group.position.x - pos.x, m.group.position.z - pos.z);
      const dy = Math.abs(m.group.position.y - pos.y);
      if (d < radius && dy < 2) out.push(id);
    }
    return out;
  }

  get count() {
    return this.mobs.size;
  }

  get zombieCount() {
    return [...this.mobs.values()].filter((m) => m.type === 'zombie').length;
  }
}
