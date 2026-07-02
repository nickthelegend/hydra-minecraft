// Remote player avatars: blocky Steve-style figures with floating name tags,
// smoothly interpolated from relay position updates.

import * as THREE from 'three';

function avatarColor(id) {
  const hue = (id * 137.508) % 360; // golden-angle spread
  return new THREE.Color().setHSL(hue / 360, 0.62, 0.5);
}

function nameSprite(name) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 30px Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const w = ctx.measureText(name).width + 24;
  ctx.fillRect(128 - w / 2, 8, w, 44);
  ctx.fillStyle = '#fff';
  ctx.fillText(name, 128, 40);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(1.9, 0.48, 1);
  return sprite;
}

export function buildAvatar(id, name) {
  const color = avatarColor(id);
  const skin = new THREE.Color(0xd8a077);
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.75, 0.28),
    new THREE.MeshLambertMaterial({ color })
  );
  body.position.y = 1.05;

  const legs = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.68, 0.26),
    new THREE.MeshLambertMaterial({ color: color.clone().multiplyScalar(0.55) })
  );
  legs.position.y = 0.34;

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.48, 0.48, 0.48),
    new THREE.MeshLambertMaterial({ color: skin })
  );
  head.position.y = 1.68;

  const tag = nameSprite(name);
  tag.position.y = 2.25;

  group.add(legs, body, head, tag);
  group.userData.head = head;
  return group;
}

export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    this.players = new Map(); // id -> { group, target: {x,y,z,yaw} }
  }

  upsert({ id, name, x, y, z, yaw }) {
    let p = this.players.get(id);
    if (!p) {
      const group = buildAvatar(id, name || `steve-${id}`);
      group.position.set(x, y, z);
      this.scene.add(group);
      p = { group, target: { x, y, z, yaw: yaw || 0 } };
      this.players.set(id, p);
    }
    p.target = { x, y, z, yaw: yaw || 0 };
  }

  remove(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.scene.remove(p.group);
    this.players.delete(id);
  }

  setAll(list) {
    for (const p of list) this.upsert(p);
  }

  update(dt) {
    const k = Math.min(1, dt * 12);
    for (const { group, target } of this.players.values()) {
      group.position.x += (target.x - group.position.x) * k;
      group.position.y += (target.y - group.position.y) * k;
      group.position.z += (target.z - group.position.z) * k;
      let dy = target.yaw - group.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      group.rotation.y += dy * k;
    }
  }

  positions() {
    return [...this.players.values()].map(({ group }) => ({
      x: group.position.x,
      z: group.position.z,
    }));
  }

  get count() {
    return this.players.size;
  }
}
