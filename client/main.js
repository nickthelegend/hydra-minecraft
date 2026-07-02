// Game entry point: Three.js scene, day/night cycle, input wiring, and the
// glue between local gameplay and the Hydra relay.

import * as THREE from 'three';
import { World, BLOCKS, AIR } from './world.js';
import { Player } from './player.js';
import { BlockRaycaster } from './raycast.js';
import { UI } from './ui.js';
import { HydraRelayClient } from './hydra-client.js';

const ACTION_PLACE = 0;
const ACTION_BREAK = 1;
const DAY_LENGTH_S = 600; // full day/night cycle

// ---- renderer / scene ------------------------------------------------------

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const DAY_SKY = new THREE.Color(0x87ceeb);
const NIGHT_SKY = new THREE.Color(0x0b1026);
scene.background = DAY_SKY.clone();
scene.fog = new THREE.Fog(scene.background, 40, 140);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);

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

// ---- world / player / ui -----------------------------------------------------

const world = new World(scene);
world.generate();

const ui = new UI();
const player = new Player(camera, world, canvas);
const raycaster = new BlockRaycaster(world, camera, scene);

// edits that arrive before terrain meshes exist are buffered
let meshesBuilt = false;
const pendingEdits = [];

function applyEdit(x, y, z, blockTypeId, rebuild = true) {
  world.setBlock(x, y, z, blockTypeId, rebuild && meshesBuilt);
}

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
  },

  onStats: (stats) => ui.updateHydra(stats),
});

// ---- block interaction -----------------------------------------------------------

function playerIntersects(x, y, z) {
  const p = player.position;
  return (
    x + 1 > p.x - 0.3 && x < p.x + 0.3 &&
    z + 1 > p.z - 0.3 && z < p.z + 0.3 &&
    y + 1 > p.y && y < p.y + 1.8
  );
}

canvas.addEventListener('mousedown', (e) => {
  if (!player.locked) return;
  const hit = raycaster.target;

  if (e.button === 0 && hit) {
    // break: apply locally right away, record on Hydra fire-and-forget
    applyEdit(hit.x, hit.y, hit.z, AIR);
    relay.sendBlockEvent(hit.x, hit.y, hit.z, hit.blockId, ACTION_BREAK);
    ui.countTxSubmitted();
  }

  if (e.button === 2 && hit) {
    const cell = raycaster.placementCell();
    if (!cell || !world.inBounds(cell.x, cell.y, cell.z)) return;
    const current = world.getBlock(cell.x, cell.y, cell.z);
    if (current !== AIR && current !== 8) return; // only into air/water
    const id = ui.selectedBlockId;
    if (BLOCKS[id].solid && playerIntersects(cell.x, cell.y, cell.z)) return;
    applyEdit(cell.x, cell.y, cell.z, id);
    relay.sendBlockEvent(cell.x, cell.y, cell.z, id, ACTION_PLACE);
    ui.countTxSubmitted();
  }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

// ---- day / night cycle --------------------------------------------------------------

const skyColor = new THREE.Color();
function updateDayNight(elapsed) {
  const phase = ((elapsed / DAY_LENGTH_S) + 0.12) % 1; // 0..1, starts mid-morning
  const angle = phase * Math.PI * 2;
  sun.position.set(Math.cos(angle) * 100, Math.sin(angle) * 100, 40);
  const daylight = Math.max(0, Math.sin(angle)); // 0 at night, 1 at noon
  sun.intensity = 0.15 + daylight * 1.0;
  ambient.intensity = 0.28 + daylight * 0.35;
  skyColor.copy(NIGHT_SKY).lerp(DAY_SKY, Math.min(1, daylight * 1.4));
  scene.background.copy(skyColor);
  scene.fog.color.copy(skyColor);
}

// ---- boot -----------------------------------------------------------------------------

world.buildAllChunks();
meshesBuilt = true;
if (pendingEdits.length) {
  for (const [x, y, z, t] of pendingEdits) applyEdit(x, y, z, t === -1 ? AIR : t, false);
  pendingEdits.length = 0;
  world.buildAllChunks();
}

// debug/console handle (also used by automated tests)
window.__game = { world, player, ui, relay, raycaster, applyEdit };

let last = performance.now();
let fpsSmooth = 60;
const start = last;

function animate(now) {
  requestAnimationFrame(animate);
  const dt = (now - last) / 1000;
  last = now;
  fpsSmooth = fpsSmooth * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;

  player.update(dt);
  const hit = raycaster.update();
  updateDayNight((now - start) / 1000);

  ui.updateDebug({ fps: fpsSmooth, position: player.position, targetBlock: hit, online: serverOnline });
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);
