// Dropped-item entities (survival mode): mini spinning block cubes with
// gravity and bounce, magnet-attracted to the player, picked up on contact.

import * as THREE from 'three';

const MAGNET_RADIUS = 2.6;
const PICKUP_RADIUS = 0.9;
const MAX_ITEMS = 160;

export class ItemDrops {
  constructor(scene, world, materials) {
    this.scene = scene;
    this.world = world;
    this.materials = materials;
    this.geometry = new THREE.BoxGeometry(0.28, 0.28, 0.28);
    this.items = []; // { mesh, blockId, vel, t }
    this.onPickup = null; // (blockId) => void
  }

  drop(x, y, z, blockId) {
    if (this.items.length >= MAX_ITEMS) return;
    const mesh = new THREE.Mesh(this.geometry, this.materials[blockId]);
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 2, 2.4 + Math.random(), (Math.random() - 0.5) * 2);
    this.scene.add(mesh);
    this.items.push({ mesh, blockId, vel, t: 0 });
  }

  update(dt, playerPos) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const p = it.mesh.position;

      // magnet + pickup (only after a short delay so drops visibly pop out)
      const eye = playerPos.clone();
      eye.y += 0.9;
      const d = p.distanceTo(eye);
      if (it.t > 0.4) {
        if (d < PICKUP_RADIUS) {
          this.scene.remove(it.mesh);
          this.items.splice(i, 1);
          this.onPickup?.(it.blockId);
          continue;
        }
        if (d < MAGNET_RADIUS) {
          const pull = eye.sub(p).normalize().multiplyScalar(9 * dt);
          it.vel.add(pull.multiplyScalar(3));
        }
      }

      // physics: gravity + voxel floor bounce
      it.vel.y -= 14 * dt;
      it.vel.multiplyScalar(1 - 1.4 * dt);
      p.addScaledVector(it.vel, dt);
      const below = this.world.isSolid(Math.floor(p.x), Math.floor(p.y - 0.15), Math.floor(p.z));
      if (below && it.vel.y < 0) {
        p.y = Math.floor(p.y - 0.15) + 1.15 + 0.001;
        it.vel.y = Math.abs(it.vel.y) > 1.6 ? -it.vel.y * 0.35 : 0;
      }

      it.mesh.rotation.y += dt * 2.4;
      it.mesh.position.y += Math.sin(it.t * 3) * 0.0015;

      // despawn after 60s
      if (it.t > 60) {
        this.scene.remove(it.mesh);
        this.items.splice(i, 1);
      }
    }
  }

  get count() {
    return this.items.length;
  }
}
