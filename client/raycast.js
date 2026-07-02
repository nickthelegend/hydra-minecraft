// Voxel raycasting (Amanatides & Woo DDA): finds the block the player is
// looking at plus the face normal, and drives the highlight wireframe.

import * as THREE from 'three';
import { AIR, BLOCKS } from './world.js';

const MAX_DISTANCE = 6;

export class BlockRaycaster {
  constructor(world, camera, scene) {
    this.world = world;
    this.camera = camera;
    this.target = null; // { x, y, z, normal: [nx, ny, nz], blockId }

    const geo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x111111, linewidth: 2 })
    );
    this.highlight.visible = false;
    scene.add(this.highlight);
  }

  // step through the voxel grid along the view ray
  cast() {
    const origin = this.camera.position;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);

    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);

    const stepX = Math.sign(dir.x) || 1;
    const stepY = Math.sign(dir.y) || 1;
    const stepZ = Math.sign(dir.z) || 1;

    const tDeltaX = Math.abs(1 / (dir.x || 1e-10));
    const tDeltaY = Math.abs(1 / (dir.y || 1e-10));
    const tDeltaZ = Math.abs(1 / (dir.z || 1e-10));

    let tMaxX = tDeltaX * (stepX > 0 ? 1 - (origin.x - x) : origin.x - x);
    let tMaxY = tDeltaY * (stepY > 0 ? 1 - (origin.y - y) : origin.y - y);
    let tMaxZ = tDeltaZ * (stepZ > 0 ? 1 - (origin.z - z) : origin.z - z);

    let normal = [0, 0, 0];
    let t = 0;

    while (t <= MAX_DISTANCE) {
      const id = this.world.getBlock(x, y, z);
      if (id !== AIR && id !== 8 /* water is not targetable */) {
        this.target = { x, y, z, normal, blockId: id };
        return this.target;
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
        normal = [-stepX, 0, 0];
      } else if (tMaxY < tMaxZ) {
        y += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
        normal = [0, -stepY, 0];
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        normal = [0, 0, -stepZ];
      }
    }
    this.target = null;
    return null;
  }

  update() {
    const hit = this.cast();
    if (hit) {
      this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      this.highlight.visible = true;
    } else {
      this.highlight.visible = false;
    }
    return hit;
  }

  // where a new block would be placed (adjacent cell on the hit face)
  placementCell() {
    if (!this.target) return null;
    const { x, y, z, normal } = this.target;
    return { x: x + normal[0], y: y + normal[1], z: z + normal[2] };
  }
}
