// First-person player: pointer-lock mouse look, WASD movement, gravity,
// jumping, AABB collision against the voxel grid, swimming in water and a
// creative fly mode (double-tap space).

import * as THREE from 'three';

const GRAVITY = 26;
const JUMP_SPEED = 8.6;
const WALK_SPEED = 5.2;
const SPRINT_SPEED = 8.5;
const SNEAK_SPEED = 1.8;
const FLY_SPEED = 11;
const SWIM_FACTOR = 0.55;
const PLAYER_HALF_W = 0.3;
const PLAYER_HEIGHT = 1.8;
const EYE_HEIGHT = 1.62;
const WATER = 8;
const MAX_BREATH = 10; // seconds underwater

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

    this.flying = false;
    this.inWater = false;
    this.eyeInWater = false;
    this.sneaking = false;
    this.sprinting = false;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.lastSpaceTap = 0;
    this.lastWTap = 0;
    this.wantSprint = false;
    this.wasFalling = 0;
    this.breath = MAX_BREATH;
    this.drownAccum = 0;

    // event hooks (set by main.js)
    this.onJump = this.onLand = this.onSplash = this.onFlyToggle = null;
    this.onDrownTick = this.onStep = null;
    this.lastStepPhase = 0;

    this.spawn();
    this.bindInput();
  }

  spawn() {
    const y = this.world.surfaceHeight(0, 0);
    this.position.set(0.5, y + 1.01, 0.5);
    this.velocity.set(0, 0, 0);
    this.flying = false;
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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return; // chat open
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) {
          const now = performance.now();
          if (now - this.lastSpaceTap < 320) {
            this.flying = !this.flying;
            this.velocity.y = 0;
            this.onFlyToggle?.(this.flying);
          }
          this.lastSpaceTap = now;
        }
      }
      if (e.code === 'KeyW' && !e.repeat) {
        const now = performance.now();
        if (now - this.lastWTap < 300) this.wantSprint = true; // double-tap W
        this.lastWTap = now;
      }
      this.keys.add(e.code);
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'KeyW') this.wantSprint = false;
      this.keys.delete(e.code); // always clear, even if chat consumed keydown
    });
  }

  // any solid block directly under the AABB (sneak edge-guard)
  hasSupport(pos) {
    const y = Math.floor(pos.y - 0.05);
    for (const dx of [-PLAYER_HALF_W, PLAYER_HALF_W]) {
      for (const dz of [-PLAYER_HALF_W, PLAYER_HALF_W]) {
        if (this.world.isSolid(Math.floor(pos.x + dx), y, Math.floor(pos.z + dz))) return true;
      }
    }
    return false;
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

    const wasInWater = this.inWater;
    this.inWater =
      this.world.getBlock(Math.floor(this.position.x), Math.floor(this.position.y + 0.4), Math.floor(this.position.z)) === WATER;
    this.eyeInWater =
      this.world.getBlock(Math.floor(this.position.x), Math.floor(this.position.y + EYE_HEIGHT), Math.floor(this.position.z)) === WATER;
    if (this.inWater && !wasInWater && this.velocity.y < -4) this.onSplash?.();

    // horizontal input in camera space (Minecraft-style: shift sneak,
    // double-tap-W or Ctrl sprint)
    const forward = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const strafe = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    this.sneaking = this.keys.has('ShiftLeft') && !this.flying && !this.inWater;
    this.sprinting = !this.sneaking && forward > 0 && (this.wantSprint || this.keys.has('ControlLeft'));
    let speed = this.flying ? FLY_SPEED : this.sneaking ? SNEAK_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED;
    if (this.inWater && !this.flying) speed *= SWIM_FACTOR;

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

    // vertical motion: fly > swim > walk
    if (this.flying) {
      const up = (this.keys.has('Space') ? 1 : 0) - (this.keys.has('ShiftLeft') ? 1 : 0);
      this.velocity.y = up * FLY_SPEED * 0.85;
    } else if (this.inWater) {
      this.velocity.y -= GRAVITY * 0.22 * dt; // gentle sink
      this.velocity.y = Math.max(this.velocity.y, -3.2);
      if (this.keys.has('Space')) this.velocity.y = Math.min(this.velocity.y + 22 * dt, 4.2);
    } else {
      this.velocity.y -= GRAVITY * dt;
      this.velocity.y = Math.max(this.velocity.y, -50);
      if (this.keys.has('Space') && this.onGround) {
        this.velocity.y = JUMP_SPEED;
        this.onGround = false;
        this.onJump?.();
      }
    }

    // axis-separated collision resolution
    const pos = this.position.clone();

    pos.x += this.velocity.x * dt;
    if (this.collides(pos) || (this.sneaking && this.onGround && !this.hasSupport(pos))) {
      pos.x = this.position.x;
      this.velocity.x = 0;
    }

    pos.z += this.velocity.z * dt;
    if (this.collides(pos) || (this.sneaking && this.onGround && !this.hasSupport(pos))) {
      pos.z = this.position.z;
      this.velocity.z = 0;
    }

    this.wasFalling = Math.min(this.velocity.y, this.wasFalling);
    pos.y += this.velocity.y * dt;
    if (this.collides(pos)) {
      if (this.velocity.y < 0) {
        if (!this.onGround && this.wasFalling < -7 && !this.inWater) this.onLand?.(this.wasFalling);
        this.onGround = true;
        this.wasFalling = 0;
        if (this.flying) this.flying = false; // land ends fly mode
      }
      pos.y = this.position.y;
      this.velocity.y = 0;
    } else if (this.velocity.y < -0.1) {
      this.onGround = false;
    }

    this.position.copy(pos);

    // fell out of the world -> respawn
    if (this.position.y < -20) this.spawn();

    // breath / drowning
    if (this.eyeInWater && !this.flying) {
      this.breath = Math.max(0, this.breath - dt);
      if (this.breath <= 0) {
        this.drownAccum += dt;
        if (this.drownAccum >= 1) {
          this.drownAccum = 0;
          this.onDrownTick?.();
        }
      }
    } else {
      this.breath = Math.min(MAX_BREATH, this.breath + dt * 2.5);
      this.drownAccum = 0;
    }

    // head bob while walking on ground + footstep events
    const moving = len > 0.5 && this.onGround && !this.flying;
    this.bobPhase += (moving ? len : 0) * dt * 1.65;
    this.bobAmount += ((moving ? 1 : 0) - this.bobAmount) * Math.min(1, dt * 8);
    const bobY = Math.sin(this.bobPhase * 2) * 0.05 * this.bobAmount;
    const bobX = Math.cos(this.bobPhase) * 0.035 * this.bobAmount;
    if (moving && Math.floor(this.bobPhase / Math.PI) !== Math.floor(this.lastStepPhase / Math.PI)) {
      const under = this.world.getBlock(Math.floor(this.position.x), Math.floor(this.position.y - 0.5), Math.floor(this.position.z));
      if (under >= 0) this.onStep?.(under);
    }
    this.lastStepPhase = this.bobPhase;

    // camera follows (eye drops slightly while sneaking)
    const eye = EYE_HEIGHT - (this.sneaking ? 0.18 : 0);
    this.camera.position.set(
      this.position.x + Math.cos(this.yaw) * bobX,
      this.position.y + eye + bobY,
      this.position.z - Math.sin(this.yaw) * bobX
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  get horizontalSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }
}
