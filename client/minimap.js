// Top-down minimap (left side, toggle with M): whole world rendered from the
// voxel data, height-shaded, with a player arrow. Columns are re-rendered
// lazily when edited.

import { BLOCKS, AIR, WORLD_HEIGHT } from './world.js';

const SCALE = 2; // canvas pixels per block

export class Minimap {
  constructor(world, canvas) {
    this.world = world;
    this.canvas = canvas;
    const { minX, maxX, minZ, maxZ } = world.bounds;
    this.minX = minX;
    this.minZ = minZ;
    this.w = maxX - minX + 1;
    this.h = maxZ - minZ + 1;
    canvas.width = this.w * SCALE;
    canvas.height = this.h * SCALE;
    this.ctx = canvas.getContext('2d');
    this.base = document.createElement('canvas');
    this.base.width = canvas.width;
    this.base.height = canvas.height;
    this.baseCtx = this.base.getContext('2d');
    this.renderAll();
  }

  columnColor(x, z) {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      const id = this.world.getBlock(x, y, z);
      if (id === AIR) continue;
      const c = BLOCKS[id].color;
      // height shading: valleys darker, peaks lighter
      const shade = 0.62 + (y / 42) * 0.55;
      const r = Math.min(255, ((c >> 16) & 0xff) * shade);
      const g = Math.min(255, ((c >> 8) & 0xff) * shade);
      const b = Math.min(255, (c & 0xff) * shade);
      return `rgb(${r | 0},${g | 0},${b | 0})`;
    }
    return '#000';
  }

  renderColumn(x, z) {
    this.baseCtx.fillStyle = this.columnColor(x, z);
    this.baseCtx.fillRect((x - this.minX) * SCALE, (z - this.minZ) * SCALE, SCALE, SCALE);
  }

  renderAll() {
    for (let x = this.minX; x < this.minX + this.w; x++) {
      for (let z = this.minZ; z < this.minZ + this.h; z++) this.renderColumn(x, z);
    }
  }

  markDirty(x, z) {
    if (x < this.minX || x >= this.minX + this.w || z < this.minZ || z >= this.minZ + this.h) return;
    this.renderColumn(x, z);
  }

  draw(playerPos, yaw, others = []) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);

    // other players: dots
    ctx.fillStyle = '#ff5252';
    for (const p of others) {
      ctx.beginPath();
      ctx.arc((p.x - this.minX) * SCALE, (p.z - this.minZ) * SCALE, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // player arrow (yaw 0 looks toward -z, i.e. up on the map)
    const px = (playerPos.x - this.minX) * SCALE;
    const pz = (playerPos.z - this.minZ) * SCALE;
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-yaw);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.2, 5);
    ctx.lineTo(0, 2.4);
    ctx.lineTo(-4.2, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
