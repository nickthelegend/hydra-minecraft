// First-person player: pointer-lock mouse look, WASD movement, gravity,
// jumping and AABB collision against the voxel grid.

import * as THREE from 'three';

const GRAVITY = 26;
const JUMP_SPEED = 8.6;
const WALK_SPEED = 5.2;
const SPRINT_SPEED = 8.5;
const PLAYER_HALF_W = 0.3;
const PLAYER_HEIGHT = 1.8;
const EYE_HEIGHT = 1.62;

export class Player {
  constructor(camera, world, domElement) {
    this.camera = camera;
    this.world = world;
    this.dom = domElement;

    this.position = new THREE.Vector3(0.5, 40, 0.5); // feet position
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.locked = false;
    this.keys = new Set();

    this.spawn();
    this.bindInput();
  }

  spawn() {
    const y = this.world.surfaceHeight(0, 0);
    this.position.set(0.5, y + 1.01, 0.5);
    this.velocity.set(0, 0, 0);
  }

  bindInput() {
    this.dom.addEventListener('click', () => {
      if (!this.locked) this.dom.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      document.getElementById('overlay-hint')?.classList.toggle('hidden', this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0024;
      this.pitch -= e.movementY * 0.0024;
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
    });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  collides(pos) {
    const minX = Math.floor(pos.x - PLAYER_HALF_W);
    const maxX = Math.floor(pos.x + PLAYER_HALF_W);
    const minY = Math.floor(pos.y);
    const maxY = Math.floor(pos.y + PLAYER_HEIGHT);
    const minZ = Math.floor(pos.z - PLAYER_HALF_W);
    const maxZ = Math.floor(pos.z + PLAYER_HALF_W);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (this.world.isSolid(x, y, z)) return true;
        }
      }
    }
    return false;
  }

  update(dt) {
    dt = Math.min(dt, 0.05);

    // horizontal input in camera space
    const forward = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const strafe = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const speed = this.keys.has('ShiftLeft') ? SPRINT_SPEED : WALK_SPEED;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let vx = (-sin * forward + cos * strafe) * speed;
    let vz = (-cos * forward - sin * strafe) * speed;
    const len = Math.hypot(vx, vz);
    if (len > speed) {
      vx = (vx / len) * speed;
      vz = (vz / len) * speed;
    }

    this.velocity.x = vx;
    this.velocity.z = vz;
    this.velocity.y -= GRAVITY * dt;
    this.velocity.y = Math.max(this.velocity.y, -50);

    if (this.keys.has('Space') && this.onGround) {
      this.velocity.y = JUMP_SPEED;
      this.onGround = false;
    }

    // axis-separated collision resolution
    const pos = this.position.clone();

    pos.x += this.velocity.x * dt;
    if (this.collides(pos)) {
      pos.x = this.position.x;
      this.velocity.x = 0;
    }

    pos.z += this.velocity.z * dt;
    if (this.collides(pos)) {
      pos.z = this.position.z;
      this.velocity.z = 0;
    }

    pos.y += this.velocity.y * dt;
    if (this.collides(pos)) {
      if (this.velocity.y < 0) this.onGround = true;
      pos.y = this.position.y;
      this.velocity.y = 0;
    } else if (this.velocity.y < -0.1) {
      this.onGround = false;
    }

    this.position.copy(pos);

    // fell out of the world -> respawn
    if (this.position.y < -20) this.spawn();

    // camera follows
    this.camera.position.set(this.position.x, this.position.y + EYE_HEIGHT, this.position.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }
}
