// Game entry point: Three.js scene, day/night cycle, survival systems,
// mining/placing/TNT with effects, mobs, multiplayer, minimap, chat — and the
// glue between local gameplay and the Hydra relay. Every world edit (player
// mining, TNT explosions, falling sand) flows through the same relay path and
// becomes an on-chain Hydra transaction.

import * as THREE from 'three';
import { World, BLOCKS, AIR } from './world.js';
import { Player } from './player.js';
import { BlockRaycaster } from './raycast.js';
import { UI } from './ui.js';
import { HydraRelayClient } from './hydra-client.js';
import { Minimap } from './minimap.js';
import { Particles, CrackOverlay, Sounds } from './effects.js';
import { RemotePlayers, buildAvatar } from './players.js';
import { ItemDrops } from './items.js';
import { Sky } from './sky.js';
import { Mobs } from './mobs.js';

const ACTION_PLACE = 0;
const ACTION_BREAK = 1;
const DAY_LENGTH_S = 600;
const WATER = 8;
const TNT = 9;

// per-block mining time (seconds of hold-to-mine) lives in BLOCKS[].hardness

// ---- renderer / scene ------------------------------------------------------

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const DAY_SKY = new THREE.Color(0x87ceeb);
const NIGHT_SKY = new THREE.Color(0x10162e);
scene.background = DAY_SKY.clone();
scene.fog = new THREE.Fog(scene.background, 40, 140);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 700);
scene.add(camera);

const ambient = new THREE.AmbientLight(0xffffff, 0.55);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xfff2cc, 1.1);
sun.position.set(60, 100, 40);
scene.add(sun);
// miner's headlamp: makes unlit caves explorable without a lighting engine
const lamp = new THREE.PointLight(0xffe8b8, 0, 9, 1.6);
camera.add(lamp);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- world / player / ui / systems ------------------------------------------

const world = new World(scene);
world.generate();

const ui = new UI();
const player = new Player(camera, world, canvas);
const raycaster = new BlockRaycaster(world, camera, scene);
const particles = new Particles(scene);
const crack = new CrackOverlay(scene);
const sounds = new Sounds();
const remotePlayers = new RemotePlayers(scene);
const drops = new ItemDrops(scene, world, world.materials);
const sky = new Sky(scene);
const mobs = new Mobs(scene, world);
const minimap = new Minimap(world, document.getElementById('minimap'));
const underwaterEl = document.getElementById('underwater');
const damageFlashEl = document.getElementById('damage-flash');

// ---- health / survival -------------------------------------------------------

let hp = 20;
let dead = false;
let regenT = 0;
let shakeT = 0;
let myId = null;

function damage(n, { shake = 0.25 } = {}) {
  if (ui.mode !== 'survival' || dead) return;
  hp = Math.max(0, hp - n);
  ui.updateHealth(hp);
  sounds.hurt();
  shakeT = Math.max(shakeT, shake);
  damageFlashEl.style.opacity = '1';
  setTimeout(() => { damageFlashEl.style.opacity = '0'; }, 120);
  if (hp <= 0) die();
}

function die() {
  dead = true;
  ui.showDeath(true);
  document.exitPointerLock?.();
}

function respawn() {
  dead = false;
  hp = 20;
  ui.updateHealth(hp);
  ui.showDeath(false);
  player.spawn();
}
document.getElementById('death-overlay').addEventListener('click', () => {
  respawn();
  canvas.requestPointerLock();
});

ui.onModeToggle = () => {
  const next = ui.mode === 'creative' ? 'survival' : 'creative';
  if (next === 'survival' && ui.counts.every((c) => c === 0)) {
    ui.counts[TNT] = 8; // starter dynamite — mine everything else
  }
  ui.setMode(next);
  hp = 20;
  ui.updateHealth(hp);
  ui.addChat('system', next === 'survival'
    ? 'survival mode: mine blocks to collect them, watch your hearts. G to go back.'
    : 'creative mode: infinite blocks, no damage.', false);
};

drops.onPickup = (blockId) => {
  ui.addItem(blockId);
  sounds.place();
};

// player event hooks
player.onJump = () => sounds.jump();
player.onSplash = () => sounds.splash();
player.onStep = (blockId) => sounds.footstep(blockId);
player.onLand = (impact) => {
  sounds.place();
  const excess = -impact - 11; // ~3 block drop is safe
  if (excess > 0) damage(Math.ceil(excess * 0.9), { shake: 0.35 });
};
player.onDrownTick = () => damage(2, { shake: 0.15 });
canvas.addEventListener('click', () => { sounds.ensure(); sounds.startWind(); }, { once: true });

// edits that arrive before terrain meshes exist are buffered
let meshesBuilt = false;
const pendingEdits = [];

function applyEdit(x, y, z, blockTypeId, rebuild = true) {
  world.setBlock(x, y, z, blockTypeId, rebuild && meshesBuilt);
  minimap.markDirty(x, z);
}

// ---- held block ("hand") + third person ---------------------------------------

const hand = new THREE.Group();
const handBlock = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), world.materials[0]);
const handEdges = new THREE.LineSegments(
  new THREE.EdgesGeometry(handBlock.geometry),
  new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.65 })
);
hand.add(handBlock, handEdges);
hand.position.set(0.5, -0.42, -0.85);
hand.rotation.set(0.25, -0.6, 0.08);
camera.add(hand);
let handSwing = 0;

ui.onSelect = (id) => { handBlock.material = world.materials[id]; };
ui.onSelect(ui.selectedBlockId);

let thirdPerson = false;
const selfAvatar = buildAvatar(0, 'you');
selfAvatar.visible = false;
scene.add(selfAvatar);
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'F5') {
    e.preventDefault();
    thirdPerson = !thirdPerson;
  }
});

// ---- hydra relay ----------------------------------------------------------------

let serverOnline = false;
const relay = new HydraRelayClient({
  onConnectionChange: (up) => { serverOnline = up; },

  onWorldState: (blocks) => {
    console.log(`[hydra-client] world state: ${blocks.length} edits`);
    for (const [x, y, z, t] of blocks) {
      if (meshesBuilt) applyEdit(x, y, z, t === -1 ? AIR : t, true);
      else pendingEdits.push([x, y, z, t]);
    }
  },

  // real-time delta from another player (or a confirmed Hydra snapshot).
  // NOTE: physics (sand, TNT) is simulated by the *originating* client and
  // arrives here as plain block events — never re-simulated, so no dupes.
  onBlockUpdate: ({ x, y, z, blockTypeId, action }) => {
    applyEdit(x, y, z, action === ACTION_BREAK ? AIR : blockTypeId, true);
    if (action === ACTION_BREAK) particles.burst(x, y, z, blockTypeId, 10);
  },

  onStats: (stats) => ui.updateHydra(stats),
  onTxConfirmed: (msg) => ui.pushFeed(msg),
  onPlayers: (list) => remotePlayers.setAll(list),
  onPlayerPos: (p) => remotePlayers.upsert(p),
  onPlayerLeave: (id) => remotePlayers.remove(id),
});
relay.onHello = ({ id, name }) => { myId = id; ui.addChat('system', `connected as ${name}`, false); };
relay.onHost = (id) => { if (id === myId) mobs.becomeHost(); };
relay.onMobs = (list) => mobs.applyState(list);
relay.onMobHit = ({ id, ix, iz }) => { if (mobs.isHost) mobs.applyHit(id, ix, iz); };
mobs.onPoof = (x, y, z) => { particles.burst(x - 0.5, y - 0.5, z - 0.5, 1, 14); };
relay.onChat = ({ id, name, text }) => ui.addChat(name, text, id === myId);
ui.onChatSend = (text) => { relay.send({ type: 'chat', text }); canvas.requestPointerLock(); };
mobs.sendState = (list) => relay.send({ type: 'mobs', list });

setInterval(() => {
  if (serverOnline) relay.sendPos(
    Number(player.position.x.toFixed(2)),
    Number(player.position.y.toFixed(2)),
    Number(player.position.z.toFixed(2)),
    Number(player.yaw.toFixed(3))
  );
}, 100);

// ---- block breaking / placing / TNT / falling sand ------------------------------

function playerIntersects(x, y, z) {
  const p = player.position;
  return (
    x + 1 > p.x - 0.3 && x < p.x + 0.3 &&
    z + 1 > p.z - 0.3 && z < p.z + 0.3 &&
    y + 1 > p.y && y < p.y + 1.8
  );
}

// the single exit point for every locally-caused world edit
function sendEdit(x, y, z, blockTypeId, action) {
  relay.sendBlockEvent(x, y, z, blockTypeId, action);
  ui.countTxSubmitted();
}

function breakBlock(x, y, z, blockId, { drop = true, fx = true } = {}) {
  applyEdit(x, y, z, AIR);
  if (fx) {
    particles.burst(x, y, z, blockId);
    sounds.break_(blockId);
  }
  if (drop && ui.mode === 'survival' && blockId !== WATER) drops.drop(x, y, z, blockId);
  sendEdit(x, y, z, blockId, ACTION_BREAK);
  checkFallingSand(x, y + 1, z);
}

// sand falls when its support disappears; the fall is re-recorded on-chain as
// break@top + place@bottom by the client that caused it
const fallingBlocks = [];
function checkFallingSand(x, y, z) {
  const id = world.getBlock(x, y, z);
  if (id === AIR || !BLOCKS[id].falls) return;
  if (world.getBlock(x, y - 1, z) !== AIR) return;
  // find landing cell (stacked falls in the same column land one higher each)
  let landY = y - 1;
  while (landY > 0 && world.getBlock(x, landY - 1, z) === AIR) landY--;
  landY += fallingBlocks.filter((f) => f.x === x && f.z === z).length;
  applyEdit(x, y, z, AIR);
  sendEdit(x, y, z, id, ACTION_BREAK);
  const mesh = new THREE.Mesh(world.geometry, world.materials[id]);
  mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
  scene.add(mesh);
  fallingBlocks.push({ mesh, x, z, id, vy: 0, targetY: landY });
  checkFallingSand(x, y + 1, z); // the block above may fall too
}

function updateFallingBlocks(dt) {
  for (let i = fallingBlocks.length - 1; i >= 0; i--) {
    const f = fallingBlocks[i];
    f.vy -= 22 * dt;
    f.mesh.position.y += f.vy * dt;
    if (f.mesh.position.y <= f.targetY + 0.5) {
      scene.remove(f.mesh);
      fallingBlocks.splice(i, 1);
      applyEdit(f.x, f.targetY, f.z, f.id);
      sendEdit(f.x, f.targetY, f.z, f.id, ACTION_PLACE);
      sounds.place();
    }
  }
}

// TNT: punch to ignite; every block the blast destroys is an on-chain break
const primedTnt = [];
function igniteTnt(x, y, z, fuse = 2.2) {
  applyEdit(x, y, z, AIR);
  sendEdit(x, y, z, TNT, ACTION_BREAK); // the TNT block itself leaves the world
  const mesh = new THREE.Mesh(world.geometry, world.materials[TNT].clone());
  mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
  scene.add(mesh);
  primedTnt.push({ mesh, x, y, z, t: fuse, blink: 0 });
  sounds.fuse();
}

function explode(x, y, z) {
  const R = 2.9;
  sounds.explosion();
  shakeT = Math.max(shakeT, 0.7);
  particles.burst(x, y, z, TNT, 30);
  particles.burst(x, y, z, 2, 24);

  for (let dx = -3; dx <= 3; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dz = -3; dz <= 3; dz++) {
        if (dx * dx + dy * dy + dz * dz > R * R) continue;
        const bx = x + dx, by = y + dy, bz = z + dz;
        const id = world.getBlock(bx, by, bz);
        if (id === AIR || id === WATER) continue;
        if (id === TNT) {
          igniteTnt(bx, by, bz, 0.25 + Math.random() * 0.4); // chain reaction
          continue;
        }
        applyEdit(bx, by, bz, AIR, false);
        minimap.markDirty(bx, bz);
        sendEdit(bx, by, bz, id, ACTION_BREAK);
      }
    }
  }
  // rebuild the touched chunks once
  for (const [cx, cz] of [[x - 3, z - 3], [x + 3, z - 3], [x - 3, z + 3], [x + 3, z + 3], [x, z]]) {
    world.rebuildChunkAt(cx, cz, true);
  }
  for (let dx = -4; dx <= 4; dx += 2) {
    for (let dz = -4; dz <= 4; dz += 2) checkFallingSand(x + dx, y + 4, z + dz);
  }

  // knockback + blast damage
  const to = player.position.clone().add(new THREE.Vector3(0, 0.9, 0)).sub(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
  const d = to.length();
  if (d < 7) {
    const k = (1 - d / 7);
    player.velocity.addScaledVector(to.normalize(), k * 14);
    player.velocity.y += k * 6;
    damage(Math.ceil(k * 12), { shake: 0.6 });
  }
}

function updateTnt(dt) {
  for (let i = primedTnt.length - 1; i >= 0; i--) {
    const p = primedTnt[i];
    p.t -= dt;
    p.blink += dt;
    if (p.blink > 0.18) {
      p.blink = 0;
      p.mesh.material.emissive = new THREE.Color(p.mesh.material.emissive?.r ? 0x000000 : 0xffffff);
      p.mesh.material.emissiveIntensity = 0.7;
      sounds.fuse();
    }
    const s = 1 + Math.max(0, 0.35 - p.t * 0.15);
    p.mesh.scale.setScalar(Math.min(1.15, s));
    if (p.t <= 0) {
      scene.remove(p.mesh);
      primedTnt.splice(i, 1);
      explode(p.x, p.y, p.z);
    }
  }
}

// ---- mouse interaction ------------------------------------------------------------

const mining = { active: false, key: null, progress: 0, lastStage: -1 };

function resetMining() {
  mining.active = false;
  mining.key = null;
  mining.progress = 0;
  mining.lastStage = -1;
  crack.hide();
}

function tryPlace() {
  const hit = raycaster.target;
  if (!hit) return;
  const cell = raycaster.placementCell();
  if (!cell || !world.inBounds(cell.x, cell.y, cell.z)) return;
  const current = world.getBlock(cell.x, cell.y, cell.z);
  if (current !== AIR && current !== WATER) return;
  const id = ui.selectedBlockId;
  if (BLOCKS[id].solid && playerIntersects(cell.x, cell.y, cell.z)) return;
  if (!ui.consumeSelected()) return; // survival: need the block in inventory

  // sand placed over air falls immediately
  if (BLOCKS[id].falls && world.getBlock(cell.x, cell.y - 1, cell.z) === AIR) {
    let landY = cell.y - 1;
    while (landY > 0 && world.getBlock(cell.x, landY - 1, cell.z) === AIR) landY--;
    const mesh = new THREE.Mesh(world.geometry, world.materials[id]);
    mesh.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
    scene.add(mesh);
    fallingBlocks.push({ mesh, x: cell.x, z: cell.z, id, vy: 0, targetY: landY });
    handSwing = 1;
    return;
  }

  applyEdit(cell.x, cell.y, cell.z, id);
  popIn(cell.x, cell.y, cell.z, id);
  sounds.place();
  sendEdit(cell.x, cell.y, cell.z, id, ACTION_PLACE);
  handSwing = 1;
}

const pops = [];
function popIn(x, y, z, id) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), world.materials[id]);
  mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
  mesh.scale.setScalar(0.4);
  scene.add(mesh);
  pops.push({ mesh, t: 0 });
}

let placeTimer = null;
canvas.addEventListener('mousedown', (e) => {
  if (!player.locked || dead) return;

  if (e.button === 0) {
    // punch a sheep?
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const mobId = mobs.raycastMob(camera.position, dir);
    if (mobId !== null) {
      sounds.bleat();
      handSwing = 1;
      const kx = dir.x, kz = dir.z;
      if (mobs.isHost) mobs.applyHit(mobId, kx, kz);
      else relay.send({ type: 'mobHit', id: mobId, ix: kx, iz: kz });
      return;
    }
    // punch TNT -> ignite
    const hit = raycaster.target;
    if (hit && hit.blockId === TNT) {
      igniteTnt(hit.x, hit.y, hit.z);
      handSwing = 1;
      return;
    }
    mining.active = true;
  }

  if (e.button === 1) { // middle click: pick block
    e.preventDefault();
    const hit = raycaster.target;
    if (hit) ui.select(hit.blockId);
  }

  if (e.button === 2) {
    tryPlace();
    clearInterval(placeTimer);
    placeTimer = setInterval(tryPlace, 260);
  }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) resetMining();
  if (e.button === 2) clearInterval(placeTimer);
});
document.addEventListener('pointerlockchange', () => {
  resetMining();
  clearInterval(placeTimer);
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

function updateMining(dt) {
  if (!mining.active || !player.locked || dead) return;
  const hit = raycaster.target;
  if (!hit || hit.blockId === TNT) {
    resetMining();
    mining.active = true;
    return;
  }
  const key = `${hit.x},${hit.y},${hit.z}`;
  if (key !== mining.key) {
    mining.key = key;
    mining.progress = 0;
    mining.lastStage = -1;
  }
  mining.progress += dt;
  const required = BLOCKS[hit.blockId]?.hardness ?? 0.4;
  const k = Math.min(1, mining.progress / required);
  crack.show(hit.x, hit.y, hit.z, k);
  const stage = Math.floor(k * 4);
  if (stage !== mining.lastStage) {
    mining.lastStage = stage;
    sounds.mineTick(k);
    handSwing = Math.max(handSwing, 0.55);
  }
  if (mining.progress >= required) {
    breakBlock(hit.x, hit.y, hit.z, hit.blockId);
    handSwing = 1;
    mining.key = null;
    mining.progress = 0;
    mining.lastStage = -1;
    crack.hide();
  }
}

// ---- day / night ------------------------------------------------------------------

const skyColor = new THREE.Color();
const UNDERWATER_FOG = new THREE.Color(0x14418c);
let lastDaylight = 1;
function updateDayNight(dt, elapsed) {
  const phase = ((elapsed / DAY_LENGTH_S) + 0.12) % 1;
  const angle = phase * Math.PI * 2;
  sun.position.set(Math.cos(angle) * 100, Math.sin(angle) * 100, 40);
  let daylight = Math.max(0, Math.sin(angle)) ** 0.7;
  if (window.__poseDaylight != null) daylight = window.__poseDaylight; // demo poses
  lastDaylight = daylight;
  sun.intensity = 0.25 + daylight * 0.95;
  ambient.intensity = 0.4 + daylight * 0.32;
  skyColor.copy(NIGHT_SKY).lerp(DAY_SKY, Math.min(1, daylight * 1.35));
  scene.background.copy(skyColor);
  sky.update(dt, angle, daylight, player.position);

  if (player.eyeInWater) {
    scene.fog.color.copy(UNDERWATER_FOG);
    scene.fog.near = 2;
    scene.fog.far = 22;
    underwaterEl.style.display = 'block';
  } else {
    scene.fog.color.copy(skyColor);
    scene.fog.near = 40;
    scene.fog.far = 140;
    underwaterEl.style.display = 'none';
  }
}

// ambient birds during the day
let chirpT = 8;

// zombies bite the local player on contact (1s cooldown), groan when close
let biteCooldown = 0;
let groanT = 4;
function updateZombieAttacks(dt) {
  biteCooldown = Math.max(0, biteCooldown - dt);
  groanT -= dt;
  if (dead) return;
  const touching = mobs.hostileTouching(player.position);
  if (touching.length && biteCooldown === 0) {
    biteCooldown = 1;
    damage(3, { shake: 0.3 });
    // shove the player away from the biter
    const z = mobs.mobs.get(touching[0]);
    if (z) {
      const away = player.position.clone().sub(z.group.position).setY(0).normalize();
      player.velocity.addScaledVector(away, 6);
      player.velocity.y += 3.5;
    }
  }
  if (groanT <= 0) {
    groanT = 3 + Math.random() * 5;
    const nearZombie = [...mobs.mobs.values()].some((m) =>
      m.type === 'zombie' && m.group.position.distanceTo(player.position) < 10);
    if (nearZombie) sounds.groan();
  }
}

// ---- boot -----------------------------------------------------------------------------

world.buildAllChunks();
meshesBuilt = true;
if (pendingEdits.length) {
  for (const [x, y, z, t] of pendingEdits) applyEdit(x, y, z, t === -1 ? AIR : t, false);
  pendingEdits.length = 0;
  world.buildAllChunks();
}
minimap.renderAll();
ui.updateHealth(hp);

let last = performance.now();
let fpsSmooth = 60;
const start = last;

function animate(now) {
  requestAnimationFrame(animate);
  const dt = (now - last) / 1000;
  last = now;
  step(dt, now);
}

function step(dt, now = performance.now()) {
  dt = Math.min(dt, 0.1);
  fpsSmooth = fpsSmooth * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;

  if (!dead) player.update(dt);
  const hit = raycaster.update();
  updateMining(dt);
  updateTnt(dt);
  updateFallingBlocks(dt);
  particles.update(dt);
  drops.update(dt, player.position);
  remotePlayers.update(dt);
  // host simulates mobs against every player position (self + remote)
  const playerSpots = [{ x: player.position.x, z: player.position.z }, ...remotePlayers.positions()];
  mobs.update(dt, lastDaylight, playerSpots);
  updateZombieAttacks(dt);
  updateDayNight(dt, (now - start) / 1000);

  // ambient chirps in daylight
  chirpT -= dt;
  if (chirpT <= 0) {
    chirpT = 10 + Math.random() * 22;
    if (lastDaylight > 0.35) sounds.chirp();
  }

  // held block swing + bob (first person only)
  handSwing = Math.max(0, handSwing - dt * 5);
  const swingK = Math.sin(handSwing * Math.PI);
  hand.visible = !thirdPerson;
  hand.rotation.x = 0.25 - swingK * 0.9;
  hand.position.y = -0.42 - swingK * 0.1 + Math.sin(player.bobPhase * 2) * 0.02 * player.bobAmount;
  hand.position.z = -0.85 - swingK * 0.12;

  // headlamp: bright underground, soft at night, off in daylight
  const underground = player.position.y + 1.6 <
    world.surfaceHeight(Math.floor(player.position.x), Math.floor(player.position.z)) - 0.5;
  const lampTarget = underground ? 1.6 : lastDaylight < 0.25 ? 0.55 : 0;
  lamp.intensity += (lampTarget - lamp.intensity) * Math.min(1, dt * 4);

  // sprint / fly FOV kick
  const targetFov = player.flying ? 80 : player.sprinting ? 83 : 75;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 8);
  camera.updateProjectionMatrix();

  // third person: pull the camera back along the view ray (with wall backoff)
  selfAvatar.visible = thirdPerson;
  if (thirdPerson) {
    selfAvatar.position.copy(player.position);
    selfAvatar.rotation.y = player.yaw;
    const back = new THREE.Vector3();
    camera.getWorldDirection(back).negate();
    let dist = 4;
    const eye = camera.position.clone();
    for (let d = 0.5; d <= 4; d += 0.25) {
      const p = eye.clone().addScaledVector(back, d);
      if (world.isSolid(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))) {
        dist = d - 0.35;
        break;
      }
    }
    camera.position.addScaledVector(back, dist);
  }

  // camera shake (damage / explosions)
  if (shakeT > 0) {
    shakeT = Math.max(0, shakeT - dt);
    const s = shakeT * 0.35;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    camera.position.z += (Math.random() - 0.5) * s;
  }

  // placed-block pop animation
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i];
    p.t += dt;
    const k = Math.min(1, p.t / 0.14);
    p.mesh.scale.setScalar(0.4 + k * 0.65);
    if (k >= 1) {
      scene.remove(p.mesh);
      pops.splice(i, 1);
    }
  }

  // HUD
  ui.updateBreath(player.breath, 10, player.eyeInWater && ui.mode === 'survival');
  if (ui.mode === 'survival' && !dead) {
    regenT += dt;
    if (regenT > 4 && hp < 20 && hp > 0) {
      regenT = 0;
      hp = Math.min(20, hp + 1);
      ui.updateHealth(hp);
    }
  }

  minimap.draw(player.position, player.yaw, remotePlayers.positions());
  ui.updateDebug({
    fps: fpsSmooth,
    position: player.position,
    targetBlock: hit,
    online: serverOnline,
    mode: player.flying ? 'flying' : player.inWater ? 'swimming' : player.sneaking ? 'sneaking' : 'walking',
    others: remotePlayers.count,
    mobs: mobs.count,
  });
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

// ---- demo poses (?pose=vista|overlay|mine|tnt|cave|night|multi) ---------------
// Deterministic staged scenes for screenshots and marketing captures.

function applyPose(name) {
  const hint = document.getElementById('overlay-hint');
  hint?.classList.add('hidden');
  const pose = (x, y, z, yaw, pitch) => {
    player.position.set(x, y, z);
    player.velocity.set(0, 0, 0);
    player.yaw = yaw;
    player.pitch = pitch;
  };
  const surf = (x, z) => world.surfaceHeight(x, z);

  switch (name) {
    case 'vista': {
      pose(10.5, surf(10, 10) + 1.01, 10.5, 4.71, -0.2);
      break;
    }
    case 'overlay': {
      pose(10.5, surf(10, 10) + 1.01, 10.5, 4.71, -0.16);
      if (!ui.hydraVisible) document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH' }));
      ui.pushFeed({ txHash: 'a3f40b12c9d8e7f6a1b2', snapshot: 112, x: 7, y: 27, z: 5, blockTypeId: 7, action: 0 });
      ui.pushFeed({ txHash: 'c86d805c52796426aa10', snapshot: 113, x: -8, y: 22, z: -9, blockTypeId: 13, action: 1 });
      break;
    }
    case 'mine': {
      const y = surf(4, 12);
      applyEdit(4, y + 1, 10, 13); // diamond ore in view
      pose(4.5, y + 1.01, 13.5, 0, -0.32);
      crack.show(4, y + 1, 10, 0.62);
      handSwing = 0.5;
      break;
    }
    case 'tnt': {
      const y = surf(6, 20);
      applyEdit(6, y + 1, 16, 9);
      applyEdit(8, y + 1, 17, 9);
      pose(6.5, y + 1.01, 21.5, 0, -0.18);
      ui.select(TNT);
      particles.burst(7, y + 3, 15, TNT, 26);
      particles.burst(7, y + 2, 15, 2, 18);
      break;
    }
    case 'cave': {
      pose(-49.5, 10.01, -19.5, 2.36, -0.05);
      applyEdit(-52, 10, -22, 13); // diamonds glinting in the wall
      applyEdit(-52, 9, -21, 11);
      lamp.intensity = 1.6;
      break;
    }
    case 'night': {
      window.__poseDaylight = 0.04;
      const y = surf(-6, 24);
      mobs.isHost = false;
      const z1 = mobs.ensure(9001, 'zombie', -5.5, surf(-6, 21) + 1, 21.5, Math.PI);
      z1.target = { x: -5.5, y: surf(-6, 21) + 1, z: 21.5, yaw: Math.PI };
      const z2 = mobs.ensure(9002, 'zombie', -8.5, surf(-9, 20) + 1, 20.5, Math.PI * 0.85);
      z2.target = { x: -8.5, y: surf(-9, 20) + 1, z: 20.5, yaw: Math.PI * 0.85 };
      pose(-5.5, y + 1.01, 24.5, 0, -0.08); // yaw 0 looks toward -z, at the zombies
      break;
    }
    case 'multi': {
      const y = surf(-2, 16);
      remotePlayers.upsert({ id: 501, name: 'steve-2', x: -4.5, y: surf(-5, 13) + 1, z: 13.5, yaw: 2.4 });
      remotePlayers.upsert({ id: 502, name: 'steve-3', x: 1.5, y: surf(1, 11) + 1, z: 11.5, yaw: 3.4 });
      pose(-1.5, y + 1.01, 16.5, 0.25, -0.08);
      break;
    }
  }
}

const poseName = new URLSearchParams(location.search).get('pose');
if (poseName) {
  // apply after boot + world-state arrival so edits land on final terrain
  setTimeout(() => applyPose(poseName), 900);
  setTimeout(() => applyPose(poseName), 2200); // re-assert over any late updates
}

// debug/console handle (also used by automated tests; step() lets tests pump
// frames deterministically when the tab is backgrounded and RAF is paused)
window.__game = {
  world, player, ui, relay, raycaster, applyEdit, remotePlayers, minimap,
  particles, drops, mobs, sky, step, igniteTnt, breakBlock,
  get hp() { return hp; },
  get dead() { return dead; },
};
