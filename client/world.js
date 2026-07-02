// Voxel world: block registry, seeded Perlin terrain generation, chunk
// storage and per-chunk InstancedMesh rendering.

import * as THREE from 'three';

// hardness = seconds of hold-to-mine (Minecraft-with-a-decent-tool feel)
export const BLOCKS = [
  { id: 0, name: 'Grass', color: 0x59a832, transparent: false, solid: true, hardness: 0.6 },
  { id: 1, name: 'Dirt', color: 0x7a5230, transparent: false, solid: true, hardness: 0.5 },
  { id: 2, name: 'Stone', color: 0x8a8a8a, transparent: false, solid: true, hardness: 1.5 },
  { id: 3, name: 'Sand', color: 0xd9cd8e, transparent: false, solid: true, falls: true, hardness: 0.5 },
  { id: 4, name: 'Wood', color: 0x6b4a2b, transparent: false, solid: true, hardness: 2.0 },
  { id: 5, name: 'Leaves', color: 0x2e7d32, transparent: true, opacity: 0.9, solid: true, hardness: 0.2 },
  { id: 6, name: 'Glass', color: 0xbfe3f2, transparent: true, opacity: 0.35, solid: true, hardness: 0.3 },
  { id: 7, name: 'Brick', color: 0xa5442a, transparent: false, solid: true, hardness: 2.0 },
  { id: 8, name: 'Water', color: 0x2864c8, transparent: true, opacity: 0.55, solid: false, hardness: Infinity },
  // v3+ extensions to the original 0-8 datum spec:
  { id: 9, name: 'TNT', color: 0xd94534, transparent: false, solid: true, tnt: true, hardness: Infinity },
  { id: 10, name: 'Coal Ore', color: 0x6e6e6e, transparent: false, solid: true, ore: 0x26262a, hardness: 2.0 },
  { id: 11, name: 'Iron Ore', color: 0x8d8781, transparent: false, solid: true, ore: 0xd8af93, hardness: 2.5 },
  { id: 12, name: 'Gold Ore', color: 0x8d8781, transparent: false, solid: true, ore: 0xf5d539, hardness: 3.0 },
  { id: 13, name: 'Diamond Ore', color: 0x8d8781, transparent: false, solid: true, ore: 0x63e8e0, hardness: 3.0 },
];

export const AIR = -1;

// World dimensions: 7x7 chunks of 16x16x64
export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 64;
export const CHUNKS_X = 7;
export const CHUNKS_Z = 7;
export const SEA_LEVEL = 22;
export const WORLD_SEED = 1337; // fixed: every client generates identical terrain

const SIZE_X = CHUNKS_X * CHUNK_SIZE;
const SIZE_Z = CHUNKS_Z * CHUNK_SIZE;
const MIN_X = -Math.floor(SIZE_X / 2);
const MIN_Z = -Math.floor(SIZE_Z / 2);

// ---- seeded Perlin noise ---------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Perlin {
  constructor(seed) {
    const rand = mulberry32(seed);
    this.perm = new Uint8Array(512);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  lerp(a, b, t) { return a + t * (b - a); }
  grad(hash, x, y) {
    switch (hash & 3) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      default: return -x - y;
    }
  }

  noise2(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = this.fade(xf);
    const v = this.fade(yf);
    const p = this.perm;
    const aa = p[p[X] + Y], ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    return this.lerp(
      this.lerp(this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf), u),
      this.lerp(this.grad(ab, xf, yf - 1), this.grad(bb, xf - 1, yf - 1), u),
      v
    );
  }

  octaves(x, y, n, persistence = 0.5, scale = 1) {
    let total = 0, amp = 1, freq = scale, max = 0;
    for (let i = 0; i < n; i++) {
      total += this.noise2(x * freq, y * freq) * amp;
      max += amp;
      amp *= persistence;
      freq *= 2;
    }
    return total / max;
  }
}

// deterministic per-position hash in [0,1), used for tree placement
function hash2(x, z, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hash3(x, y, z, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 2246822519) + Math.imul(z, 668265263) + seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// trilinear 3D value noise built on hash3 — used to carve caves
function vnoise3(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const lerp = (a, b, t) => a + (b - a) * t;
  let v = 0;
  const c = [];
  for (let dz = 0; dz <= 1; dz++) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        c.push(hash3(xi + dx, yi + dy, zi + dz, seed));
      }
    }
  }
  const x1 = lerp(c[0], c[1], xf), x2 = lerp(c[2], c[3], xf);
  const x3 = lerp(c[4], c[5], xf), x4 = lerp(c[6], c[7], xf);
  const y1 = lerp(x1, x2, yf), y2 = lerp(x3, x4, yf);
  return lerp(y1, y2, zf);
}

// stone base with colored ore speckles
function oreTexture(baseColor, oreColor) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#' + baseColor.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, 64, 64);
  const rand = (() => { let s = oreColor & 0xffff; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  ctx.fillStyle = '#' + oreColor.toString(16).padStart(6, '0');
  for (let i = 0; i < 9; i++) {
    const x = 4 + rand() * 52, y = 4 + rand() * 52, r = 3 + rand() * 4;
    ctx.fillRect(x, y, r, r);
    ctx.fillRect(x + r * 0.4, y - r * 0.5, r * 0.7, r * 0.7);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

// classic red block with lighter bands and "TNT" lettering
function tntTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d94534';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#f2e7d5';
  ctx.fillRect(0, 22, 64, 20);
  ctx.fillStyle = '#3a3a3a';
  ctx.font = 'bold 16px Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('TNT', 32, 38);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, 0, 64, 6);
  ctx.fillRect(0, 58, 64, 6);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

// ---- world -----------------------------------------------------------------

export class World {
  constructor(scene) {
    this.scene = scene;
    this.blocks = new Uint8Array(SIZE_X * WORLD_HEIGHT * SIZE_Z); // 0 = air, else id+1
    this.chunkMeshes = new Map(); // "cx,cz" -> THREE.Group
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.materials = BLOCKS.map((b) => {
      if (b.tnt) {
        return new THREE.MeshLambertMaterial({ map: tntTexture(), color: 0xffffff });
      }
      if (b.ore) {
        return new THREE.MeshLambertMaterial({ map: oreTexture(b.color, b.ore), color: 0xffffff });
      }
      return new THREE.MeshLambertMaterial({
        color: b.color,
        transparent: b.transparent,
        opacity: b.opacity ?? 1,
      });
    });
    this.bounds = { minX: MIN_X, maxX: MIN_X + SIZE_X - 1, minZ: MIN_Z, maxZ: MIN_Z + SIZE_Z - 1 };
  }

  inBounds(x, y, z) {
    return x >= this.bounds.minX && x <= this.bounds.maxX &&
      z >= this.bounds.minZ && z <= this.bounds.maxZ &&
      y >= 0 && y < WORLD_HEIGHT;
  }

  index(x, y, z) {
    const lx = x - MIN_X, lz = z - MIN_Z;
    return (lx * SIZE_Z + lz) * WORLD_HEIGHT + y;
  }

  getBlock(x, y, z) {
    if (!this.inBounds(x, y, z)) return AIR;
    const v = this.blocks[this.index(x, y, z)];
    return v === 0 ? AIR : v - 1;
  }

  setBlock(x, y, z, id, rebuild = true) {
    if (!this.inBounds(x, y, z)) return;
    this.blocks[this.index(x, y, z)] = id === AIR ? 0 : id + 1;
    if (rebuild) this.rebuildChunkAt(x, z, true);
  }

  isSolid(x, y, z) {
    const id = this.getBlock(x, y, z);
    return id !== AIR && BLOCKS[id].solid;
  }

  // ---- terrain generation --------------------------------------------------

  // ore veins: coarse 2x2x2 cluster hash so ores appear in small veins,
  // rarer + more precious with depth (coal < iron < gold < diamond)
  oreAt(x, y, z) {
    const cx = x >> 1, cy = y >> 1, cz = z >> 1;
    if (y < 9 && hash3(cx, cy, cz, WORLD_SEED + 44) < 0.013) return 13; // diamond
    if (y < 14 && hash3(cx, cy, cz, WORLD_SEED + 33) < 0.016) return 12; // gold
    if (y < 22 && hash3(cx, cy, cz, WORLD_SEED + 22) < 0.024) return 11; // iron
    if (y < 30 && hash3(cx, cy, cz, WORLD_SEED + 11) < 0.032) return 10; // coal
    return 2; // plain stone
  }

  // worm-like cave carving via two 3D value-noise fields
  isCave(x, y, z) {
    const n1 = vnoise3(x / 13, y / 9, z / 13, WORLD_SEED + 7);
    if (Math.abs(n1 - 0.5) > 0.062) return false;
    const n2 = vnoise3(x / 21 + 90, y / 15, z / 21, WORLD_SEED + 77);
    return Math.abs(n2 - 0.5) < 0.18;
  }

  generate() {
    const perlin = new Perlin(WORLD_SEED);
    for (let x = this.bounds.minX; x <= this.bounds.maxX; x++) {
      for (let z = this.bounds.minZ; z <= this.bounds.maxZ; z++) {
        const n = perlin.octaves(x, z, 4, 0.5, 1 / 48);
        const height = Math.max(2, Math.floor(26 + n * 14));
        // caves only under dry land so they never breach the sea floor
        const canCarve = height > SEA_LEVEL + 1;
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          let id = AIR;
          if (y < height - 4) {
            if (canCarve && y >= 3 && this.isCave(x, y, z)) continue; // cave air
            id = this.oreAt(x, y, z);
          } else if (y < height) id = 1; // dirt
          else if (y === height) {
            id = height <= SEA_LEVEL + 1 ? 3 : 0; // sand near water, else grass
          } else if (y <= SEA_LEVEL) {
            id = 8; // water fills valleys up to sea level
          }
          if (id !== AIR) this.setBlock(x, y, z, id, false);
        }
        // sparse trees on grass, away from the water line
        if (height > SEA_LEVEL + 2 && hash2(x, z, WORLD_SEED) < 0.008) {
          this.plantTree(x, height + 1, z);
        }
      }
    }
  }

  plantTree(x, y, z) {
    const h = 4 + Math.floor(hash2(x, z, 99) * 2);
    for (let i = 0; i < h; i++) this.setBlock(x, y + i, z, 4, false);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dy = h - 2; dy <= h + 1; dy++) {
          const dist = Math.abs(dx) + Math.abs(dz) + Math.max(0, dy - (h - 1));
          if (dist <= 3 && !(dx === 0 && dz === 0 && dy < h)) {
            if (this.getBlock(x + dx, y + dy, z + dz) === AIR) {
              this.setBlock(x + dx, y + dy, z + dz, 5, false);
            }
          }
        }
      }
    }
  }

  // ---- rendering -------------------------------------------------------------

  chunkOf(x, z) {
    return [Math.floor((x - MIN_X) / CHUNK_SIZE), Math.floor((z - MIN_Z) / CHUNK_SIZE)];
  }

  buildAllChunks() {
    for (let cx = 0; cx < CHUNKS_X; cx++) {
      for (let cz = 0; cz < CHUNKS_Z; cz++) this.rebuildChunk(cx, cz);
    }
  }

  rebuildChunkAt(x, z, withNeighbors = false) {
    const [cx, cz] = this.chunkOf(x, z);
    this.rebuildChunk(cx, cz);
    if (!withNeighbors) return;
    // edits on a chunk border change face visibility in the neighbor chunk
    const lx = (x - MIN_X) % CHUNK_SIZE, lz = (z - MIN_Z) % CHUNK_SIZE;
    if (lx === 0 && cx > 0) this.rebuildChunk(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1 && cx < CHUNKS_X - 1) this.rebuildChunk(cx + 1, cz);
    if (lz === 0 && cz > 0) this.rebuildChunk(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1 && cz < CHUNKS_Z - 1) this.rebuildChunk(cx, cz + 1);
  }

  isExposed(x, y, z, id) {
    const neighbors = [
      [x + 1, y, z], [x - 1, y, z], [x, y + 1, z],
      [x, y - 1, z], [x, y, z + 1], [x, y, z - 1],
    ];
    for (const [nx, ny, nz] of neighbors) {
      const n = this.getBlock(nx, ny, nz);
      if (n === AIR) return true;
      if (BLOCKS[n].transparent && n !== id) return true;
    }
    return false;
  }

  rebuildChunk(cx, cz) {
    const key = `${cx},${cz}`;
    const old = this.chunkMeshes.get(key);
    if (old) {
      this.scene.remove(old);
      old.children.forEach((m) => m.dispose?.());
    }

    const x0 = MIN_X + cx * CHUNK_SIZE, z0 = MIN_Z + cz * CHUNK_SIZE;
    const positionsByType = BLOCKS.map(() => []);

    for (let x = x0; x < x0 + CHUNK_SIZE; x++) {
      for (let z = z0; z < z0 + CHUNK_SIZE; z++) {
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          const id = this.getBlock(x, y, z);
          if (id === AIR) continue;
          if (this.isExposed(x, y, z, id)) positionsByType[id].push(x, y, z);
        }
      }
    }

    const group = new THREE.Group();
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();

    for (let id = 0; id < BLOCKS.length; id++) {
      const positions = positionsByType[id];
      const count = positions.length / 3;
      if (count === 0) continue;
      const mesh = new THREE.InstancedMesh(this.geometry, this.materials[id], count);
      for (let i = 0; i < count; i++) {
        const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
        matrix.setPosition(x + 0.5, y + 0.5, z + 0.5);
        mesh.setMatrixAt(i, matrix);
        // subtle deterministic brightness variation for a textured feel
        const tint = 0.92 + hash2(x * 31 + y, z * 17 + y, 7) * 0.13;
        color.setHex(BLOCKS[id].color).multiplyScalar(tint);
        mesh.setColorAt(i, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      group.add(mesh);
    }

    this.scene.add(group);
    this.chunkMeshes.set(key, group);
  }

  surfaceHeight(x, z) {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      if (this.isSolid(x, y, z)) return y;
    }
    return 0;
  }
}
