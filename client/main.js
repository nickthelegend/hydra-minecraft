// Game entry point: Three.js scene, day/night cycle, mining/placing with
// effects, multiplayer avatars, minimap, and the glue between local gameplay
// and the Hydra relay.

import * as THREE from 'three';
import { World, BLOCKS, AIR } from './world.js';
import { Player } from './player.js';
import { BlockRaycaster } from './raycast.js';
import { UI } from './ui.js';
import { HydraRelayClient } from './hydra-client.js';
import { Minimap } from './minimap.js';
import { Particles, CrackOverlay, Sounds } from './effects.js';
import { RemotePlayers } from './players.js';

const ACTION_PLACE = 0;
const ACTION_BREAK = 1;
const DAY_LENGTH_S = 600; // full day/night cycle

// seconds of mining per block type (hold left mouse)
const HARDNESS = [0.3, 0.35, 0.85, 0.28, 0.55, 0.12, 0.18, 0.85, Infinity];

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

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);
scene.add(camera); // so camera-attached objects (held block) render

const ambient = new THREE.AmbientLight(0xffffff, 0.55);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xfff2cc, 1.1);
sun.position.set(60, 100, 40);
scene.add(sun);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- world / player / ui / effects ------------------------------------------

const world = new World(scene);
world.generate();

const ui = new UI();
const player = new Player(camera, world, canvas);
const raycaster = new BlockRaycaster(world, camera, scene);
const particles = new Particles(scene);
const crack = new CrackOverlay(scene);
const sounds = new Sounds();
const remotePlayers = new RemotePlayers(scene);
const minimap = new Minimap(world, document.getElementById('minimap'));
const underwaterEl = document.getElementById('underwater');

player.onJump = () => sounds.jump();
player.onLand = () => sounds.place(); // soft thud on landing
player.onSplash = () => sounds.splash();
canvas.addEventListener('click', () => sounds.ensure(), { once: true });

// edits that arrive before terrain meshes exist are buffered
let meshesBuilt = false;
const pendingEdits = [];

function applyEdit(x, y, z, blockTypeId, rebuild = true) {
  world.setBlock(x, y, z, blockTypeId, rebuild && meshesBuilt);
  minimap.markDirty(x, z);
}

// ---- held block ("hand") ------------------------------------------------------

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
let handSwing = 0; // 1 = just swung

ui.onSelect = (id) => {
  handBlock.material = world.materials[id];
};
ui.onSelect(ui.selectedBlockId);

// ---- hydra relay ----------------------------------------------------------------

let serverOnline = false;
const relay = new HydraRelayClient({
  onConnectionChange: (up) => { serverOnline = up; },

  // full world reconstruction on join: [[x,y,z,blockTypeIdOrAir(-1)], ...]
  onWorldState: (blocks) => {
    console.log(`[hydra-client] world state: ${blocks.length} edits`);
    for (const [x, y, z, t] of blocks) {
      if (meshesBuilt) applyEdit(x, y, z, t === -1 ? AIR : t, true);
      else pendingEdits.push([x, y, z, t]);
    }
  },

  // real-time delta from another player (or a confirmed Hydra snapshot)
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

// broadcast our position at 10 Hz
setInterval(() => {
  if (serverOnline) relay.sendPos(
    Number(player.position.x.toFixed(2)),
    Number(player.position.y.toFixed(2)),
    Number(player.position.z.toFixed(2)),
    Number(player.yaw.toFixed(3))
  );
}, 100);

// ---- block interaction: hold-to-mine + place ------------------------------------

function playerIntersects(x, y, z) {
  const p = player.position;
  return (
    x + 1 > p.x - 0.3 && x < p.x + 0.3 &&
    z + 1 > p.z - 0.3 && z < p.z + 0.3 &&
    y + 1 > p.y && y < p.y + 1.8
  );
}

const mining = { active: false, key: null, progress: 0, lastStage: -1 };

function resetMining() {
  mining.active = false;
  mining.key = null;
  mining.progress = 0;
  mining.lastStage = -1;
  crack.hide();
}

function finishBreak(hit) {
  applyEdit(hit.x, hit.y, hit.z, AIR);
  particles.burst(hit.x, hit.y, hit.z, hit.blockId);
  sounds.break_(hit.blockId);
  relay.sendBlockEvent(hit.x, hit.y, hit.z, hit.blockId, ACTION_BREAK);
  ui.countTxSubmitted();
  handSwing = 1;
}

function tryPlace() {
  const hit = raycaster.target;
  if (!hit) return;
  const cell = raycaster.placementCell();
  if (!cell || !world.inBounds(cell.x, cell.y, cell.z)) return;
  const current = world.getBlock(cell.x, cell.y, cell.z);
  if (current !== AIR && current !== 8) return; // only into air/water
  const id = ui.selectedBlockId;
  if (BLOCKS[id].solid && playerIntersects(cell.x, cell.y, cell.z)) return;
  applyEdit(cell.x, cell.y, cell.z, id);
  popIn(cell.x, cell.y, cell.z, id);
  sounds.place();
  relay.sendBlockEvent(cell.x, cell.y, cell.z, id, ACTION_PLACE);
  ui.countTxSubmitted();
  handSwing = 1;
}

// short scale-in animation over a freshly placed block
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
  if (!player.locked) return;
  if (e.button === 0) {
    mining.active = true;
  }
  if (e.button === 2) {
    tryPlace();
    clearInterval(placeTimer);
    placeTimer = setInterval(tryPlace, 260); // auto-repeat while held
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
  if (!mining.active || !player.locked) return;
  const hit = raycaster.target;
  if (!hit) {
    resetMining();
    mining.active = true; // still holding: resume when a block is targeted
    return;
  }
  const key = `${hit.x},${hit.y},${hit.z}`;
  if (key !== mining.key) {
    mining.key = key;
    mining.progress = 0;
    mining.lastStage = -1;
  }
  mining.progress += dt;
  const required = HARDNESS[hit.blockId] ?? 0.4;
  const k = Math.min(1, mining.progress / required);
  crack.show(hit.x, hit.y, hit.z, k);
  const stage = Math.floor(k * 4);
  if (stage !== mining.lastStage) {
    mining.lastStage = stage;
    sounds.mineTick(k);
    handSwing = Math.max(handSwing, 0.55);
  }
  if (mining.progress >= required) {
    finishBreak(hit);
    mining.key = null;
    mining.progress = 0;
    mining.lastStage = -1;
    crack.hide();
  }
}

// ---- day / night cycle --------------------------------------------------------------

const skyColor = new THREE.Color();
const UNDERWATER_FOG = new THREE.Color(0x14418c);
function updateDayNight(elapsed) {
  const phase = ((elapsed / DAY_LENGTH_S) + 0.12) % 1; // 0..1, starts mid-morning
  const angle = phase * Math.PI * 2;
  sun.position.set(Math.cos(angle) * 100, Math.sin(angle) * 100, 40);
  const daylight = Math.max(0, Math.sin(angle)) ** 0.7; // longer usable daylight
  sun.intensity = 0.25 + daylight * 0.95;
  ambient.intensity = 0.4 + daylight * 0.32;
  skyColor.copy(NIGHT_SKY).lerp(DAY_SKY, Math.min(1, daylight * 1.35));
  scene.background.copy(skyColor);

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

// ---- boot -----------------------------------------------------------------------------

world.buildAllChunks();
meshesBuilt = true;
if (pendingEdits.length) {
  for (const [x, y, z, t] of pendingEdits) applyEdit(x, y, z, t === -1 ? AIR : t, false);
  pendingEdits.length = 0;
  world.buildAllChunks();
}
minimap.renderAll();

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
  dt = Math.min(dt, 0.1); // RAF can pause in background tabs; avoid huge steps
  fpsSmooth = fpsSmooth * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;

  player.update(dt);
  const hit = raycaster.update();
  updateMining(dt);
  particles.update(dt);
  remotePlayers.update(dt);
  updateDayNight((now - start) / 1000);

  // held block swing + bob
  handSwing = Math.max(0, handSwing - dt * 5);
  const swingK = Math.sin(handSwing * Math.PI);
  hand.rotation.x = 0.25 - swingK * 0.9;
  hand.position.y = -0.42 - swingK * 0.1 + Math.sin(player.bobPhase * 2) * 0.02 * player.bobAmount;
  hand.position.z = -0.85 - swingK * 0.12;

  // sprint / fly FOV kick
  const sprinting = player.keys.has('ShiftLeft') && player.horizontalSpeed > 6 && !player.flying;
  const targetFov = player.flying ? 80 : sprinting ? 83 : 75;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 8);
  camera.updateProjectionMatrix();

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

  minimap.draw(player.position, player.yaw, remotePlayers.positions());
  ui.updateDebug({
    fps: fpsSmooth,
    position: player.position,
    targetBlock: hit,
    online: serverOnline,
    mode: player.flying ? 'flying' : player.inWater ? 'swimming' : 'walking',
    others: remotePlayers.count,
  });
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

// debug/console handle (also used by automated tests; step() lets tests pump
// frames deterministically when the tab is backgrounded and RAF is paused)
window.__game = { world, player, ui, relay, raycaster, applyEdit, remotePlayers, minimap, particles, step };
