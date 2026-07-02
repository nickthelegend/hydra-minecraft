// Sky dressing: sun and moon billboards that track the day/night cycle,
// stars that fade in at night, and slowly drifting clouds.

import * as THREE from 'three';

function discSprite(colorInner, colorOuter, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.5);
  g.addColorStop(0, colorInner);
  g.addColorStop(0.75, colorOuter);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false, depthWrite: false }));
}

export class Sky {
  constructor(scene) {
    this.sun = discSprite('#fff7d0', 'rgba(255,220,120,0.85)');
    this.sun.scale.set(34, 34, 1);
    this.moon = discSprite('#f2f4ff', 'rgba(170,180,220,0.7)');
    this.moon.scale.set(22, 22, 1);
    scene.add(this.sun, this.moon);

    // stars: points on the upper hemisphere
    const starCount = 420;
    const pos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.9); // bias upward
      const r = 320;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = Math.abs(r * Math.cos(phi)) + 15;
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false,
    }));
    scene.add(this.stars);

    // clouds: flat translucent slabs drifting east
    this.clouds = new THREE.Group();
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, fog: false, depthWrite: false });
    for (let i = 0; i < 16; i++) {
      const w = 14 + Math.random() * 26, d = 10 + Math.random() * 18;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, d), cloudMat);
      m.position.set((Math.random() - 0.5) * 340, 78 + Math.random() * 14, (Math.random() - 0.5) * 340);
      this.clouds.add(m);
    }
    scene.add(this.clouds);
  }

  // angle: sun angle around the world (0 = sunrise), daylight: 0..1
  update(dt, angle, daylight, center) {
    const r = 300;
    this.sun.position.set(center.x + Math.cos(angle) * r, Math.sin(angle) * r, center.z + 40);
    this.moon.position.set(center.x - Math.cos(angle) * r, -Math.sin(angle) * r, center.z - 40);
    this.stars.material.opacity = Math.max(0, 0.9 - daylight * 1.6);
    this.stars.position.set(center.x, 0, center.z);

    for (const m of this.clouds.children) {
      m.position.x += dt * 1.7;
      if (m.position.x > center.x + 190) m.position.x = center.x - 190;
    }
  }
}
