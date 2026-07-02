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

// on-chain explorer: every block action as recorded in the Hydra head, with
// its real L2 transaction hash and raw datum CBOR — proof nothing is mocked
app.get('/chain', async (_req, res) => {
  try {
    const utxoMap = await hydra.fetchUtxo();
    const records = hydra.extractBlockActions(utxoMap).map((r) => ({
      seq: r.seq,
      txHash: r.txHash,
      action: r.action === 0 ? 'place' : 'break',
      block: r.blockTypeId,
      x: r.x, y: r.y, z: r.z,
      datumCbor: r.datumCbor,
    }));
    res.json({ headUtxoCount: Object.keys(utxoMap).length, records });
  } catch (err) {
    res.status(503).json({ error: `hydra unreachable: ${err.message}` });
  }
});

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

let nextPlayerId = 1;
let hostId = null; // the client simulating ambient mobs
const playerPositions = new Map(); // id -> { id, name, x, y, z, yaw }

function pickHost() {
  const clients = [...wss.clients].filter((c) => c.readyState === WebSocket.OPEN);
  const next = clients.sort((a, b) => a.playerId - b.playerId)[0];
  hostId = next ? next.playerId : null;
  if (next) broadcast({ type: 'host', id: hostId });
}

wss.on('connection', (ws) => {
  ws.playerId = nextPlayerId++;
  ws.playerName = `steve-${ws.playerId}`;
  ws.lastChat = 0;
  console.log(`[relay] ${ws.playerName} connected (${wss.clients.size} online)`);

  // New client: identity, full edit set reconstructed from the Hydra head
  // (or accumulated locally if Hydra is down) + who else is around.
  ws.send(JSON.stringify({ type: 'hello', id: ws.playerId, name: ws.playerName }));
  ws.send(JSON.stringify({ type: 'worldState', blocks: world.toCompactArray() }));
  ws.send(JSON.stringify(statsMessage()));
  ws.send(JSON.stringify({ type: 'players', list: [...playerPositions.values()] }));
  if (hostId === null) pickHost();
  else ws.send(JSON.stringify({ type: 'host', id: hostId }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'pos': {
        const { x, y, z, yaw } = msg;
        if (![x, y, z, yaw].every(Number.isFinite)) return;
        const p = { id: ws.playerId, name: ws.playerName, x, y, z, yaw };
        playerPositions.set(ws.playerId, p);
        broadcast({ type: 'playerPos', ...p }, ws);
        return;
      }

      case 'mobs': // host broadcasts ambient mob state (not recorded on-chain)
        if (ws.playerId !== hostId || !Array.isArray(msg.list) || msg.list.length > 32) return;
        broadcast({ type: 'mobs', list: msg.list }, ws);
        return;

      case 'mobHit': { // route a punch to the simulation host
        for (const c of wss.clients) {
          if (c.playerId === hostId && c.readyState === WebSocket.OPEN) {
            c.send(JSON.stringify({ type: 'mobHit', id: msg.id, ix: msg.ix, iz: msg.iz }));
          }
        }
        return;
      }

      case 'chat': {
        const now = Date.now();
        if (typeof msg.text !== 'string' || now - ws.lastChat < 750) return;
        ws.lastChat = now;
        const text = msg.text.slice(0, 140).trim();
        if (text) broadcast({ type: 'chat', id: ws.playerId, name: ws.playerName, text });
        return;
      }

      case 'blockEvent': {
        const { x, y, z, blockTypeId, action } = msg;
        if (![x, y, z, blockTypeId, action].every(Number.isInteger)) return;
        if (blockTypeId < 0 || blockTypeId > 13 || (action !== 0 && action !== 1)) return; // 9=TNT 10-13=ores

        // 1. apply + real-time sync to all other clients immediately
        world.apply({ x, y, z, blockTypeId, action });
        rememberLocal({ x, y, z, blockTypeId, action });
        broadcast({ type: 'blockUpdate', x, y, z, blockTypeId, action, confirmed: false }, ws);

        // 2. fire-and-forget on-chain record via Hydra
        hydra.submitBlockAction({ x, y, z, blockTypeId, action });
        return;
      }

      default:
        return;
    }
  });

  ws.on('close', () => {
    playerPositions.delete(ws.playerId);
    broadcast({ type: 'playerLeave', id: ws.playerId });
    if (ws.playerId === hostId) pickHost();
    console.log(`[relay] ${ws.playerName} disconnected (${wss.clients.size} online)`);
  });
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
  // Everyone gets the confirmation receipt (feeds the in-game activity log).
  broadcast({
    type: 'txConfirmed',
    txHash: delta.txHash,
    snapshot: delta.snapshot,
    x: delta.x, y: delta.y, z: delta.z,
    blockTypeId: delta.blockTypeId,
    action: delta.action,
    seq: delta.seq,
  });

  // If this relay originated it, clients were already synced on the live
  // path — don't re-apply/re-broadcast the world change.
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
