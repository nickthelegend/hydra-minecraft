// Relay server: serves the game client, bridges browser WebSockets to the
// Hydra node, and holds the server-side signing key.
//
// Browser -> relay : { type: "blockEvent", x, y, z, blockTypeId, action }
// Relay -> browser : { type: "worldState", blocks: [[x,y,z,blockTypeIdOrAir],...] }
//                    { type: "blockUpdate", x, y, z, blockTypeId, action, confirmed? }
//                    { type: "hydraStats", ... }
//
// The game is fully playable if the Hydra node is unreachable: block events
// still apply locally + broadcast to other clients; Hydra submission is
// fire-and-forget and resumes when the node comes back.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { runSetup, loadCredentials } from './setup.js';
import { HydraClient } from './hydra.js';
import { WorldState } from './world-state.js';

const PORT = Number(process.env.PORT || 3000);
const HYDRA_HOST = process.env.HYDRA_HOST || '127.0.0.1';
const HYDRA_PORT = Number(process.env.HYDRA_PORT || 14001);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

runSetup();
const { privKey, address } = loadCredentials();

const world = new WorldState();
const hydra = new HydraClient({
  wsUrl: `ws://${HYDRA_HOST}:${HYDRA_PORT}`,
  httpUrl: `http://${HYDRA_HOST}:${HYDRA_PORT}`,
  privKey,
  address,
});

// ---- express + websocket -------------------------------------------------

const app = express();
app.use(express.static(path.join(root, 'client')));
app.get('/health', (_req, res) => res.json({ ok: true, hydra: hydra.stats, edits: world.edits.size }));

const server = app.listen(PORT, () => {
  console.log(`[relay] game running at http://localhost:${PORT}`);
});

const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(msg, except = null) {
  const raw = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client !== except && client.readyState === WebSocket.OPEN) client.send(raw);
  }
}

function statsMessage() {
  return { type: 'hydraStats', ...hydra.stats, connected: hydra.connected, queued: hydra.queue.length };
}

wss.on('connection', (ws) => {
  console.log(`[relay] client connected (${wss.clients.size} online)`);

  // New client: send the full edit set reconstructed from the Hydra head
  // (or accumulated locally if Hydra is down).
  ws.send(JSON.stringify({ type: 'worldState', blocks: world.toCompactArray() }));
  ws.send(JSON.stringify(statsMessage()));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type !== 'blockEvent') return;

    const { x, y, z, blockTypeId, action } = msg;
    if (![x, y, z, blockTypeId, action].every(Number.isInteger)) return;
    if (blockTypeId < 0 || blockTypeId > 8 || (action !== 0 && action !== 1)) return;

    // 1. apply + real-time sync to all other clients immediately
    world.apply({ x, y, z, blockTypeId, action });
    rememberLocal({ x, y, z, blockTypeId, action });
    broadcast({ type: 'blockUpdate', x, y, z, blockTypeId, action, confirmed: false }, ws);

    // 2. fire-and-forget on-chain record via Hydra
    hydra.submitBlockAction({ x, y, z, blockTypeId, action });
  });

  ws.on('close', () => console.log(`[relay] client disconnected (${wss.clients.size} online)`));
});

// ---- dedup between live path and SnapshotConfirmed path -------------------

const recentLocal = new Map(); // "x,y,z,type,action" -> pending confirm count
function localKey(e) {
  return `${e.x},${e.y},${e.z},${e.blockTypeId},${e.action}`;
}
function rememberLocal(e) {
  const k = localKey(e);
  recentLocal.set(k, (recentLocal.get(k) || 0) + 1);
}
function consumeLocal(e) {
  const k = localKey(e);
  const n = recentLocal.get(k) || 0;
  if (n <= 0) return false;
  n === 1 ? recentLocal.delete(k) : recentLocal.set(k, n - 1);
  return true;
}

// ---- hydra events ----------------------------------------------------------

hydra.on('worldReplay', (actions) => {
  if (world.eventCount === 0) {
    world.replay(actions);
  } else {
    for (const a of actions) world.apply(a);
  }
});

hydra.on('blockDelta', (delta) => {
  // Confirmed by a Hydra snapshot. If this relay originated it, clients were
  // already synced on the live path — don't re-broadcast, just count it.
  if (consumeLocal(delta)) return;
  world.apply(delta);
  broadcast({
    type: 'blockUpdate',
    x: delta.x,
    y: delta.y,
    z: delta.z,
    blockTypeId: delta.blockTypeId,
    action: delta.action,
    confirmed: true,
  });
});

hydra.on('stats', () => broadcast(statsMessage()));

hydra.connect();
