# The Prompt

This entire project — a playable Minecraft-style voxel game where **every block
action becomes a real Cardano transaction on a Hydra L2 head** — was built by
**Claude Fable 5** (Anthropic) running inside Claude Code, from **one prompt**,
fully autonomously, while the author slept.

> Fable 5 is a killer model. It wrote the game, wrote the relay, stood up the
> Hydra node, found the port conflicts, worked around an amd64-only Docker
> image on Apple Silicon, tested everything end to end in a real browser,
> decoded its own CBOR datums off the head to prove nothing was mocked, and
> wrote the evaluation report — in ~18.5 minutes of wall-clock time for v1.
> No human touched the keyboard.

The scoreboard for the initial build is in [EVALUATION.md](EVALUATION.md):
12/12 features, 1,717 lines, zero human interventions. v2–v4 (game feel,
survival, TNT, mobs, caves, ores) came from three tiny follow-up prompts,
listed at the bottom.

## How to rebuild this with Fable 5

1. Install [Claude Code](https://claude.com/claude-code) and select the
   **Fable 5** model.
2. Have Docker running (any hydra-node-capable image; on Apple Silicon you
   may want a native arm64 build — Fable figures this out itself if you have
   one).
3. Paste the prompt below. Walk away. Seriously — the original run included
   "i am sleeping, no questions, surprise me", and that's the intended UX.
4. When it's done, `npm start`, open the printed URL, press `H`, and watch
   your blocks become L2 transactions.

## The original prompt (v1, verbatim)

```
Build a fully playable Minecraft-style voxel game that runs in the browser using Three.js, with Cardano Hydra L2 running silently in the background to record every block action as an on-chain transaction.

─────────────────────────────────────────
CORE GAME (Three.js)
─────────────────────────────────────────

Build a voxel world renderer using Three.js with the following:

- Infinite-ish chunked terrain (at least 5x5 chunks, 16x16x64 blocks each)
- Perlin noise terrain generation with grass, dirt, stone, sand, water layers
- Instanced mesh rendering for performance (InstancedMesh per block type)
- First-person camera with pointer lock controls (WASD + mouse look)
- Player physics: gravity, jumping, collision detection with blocks
- Block raycasting: highlight the block face the player is looking at
- Left click = break block, right click = place block
- Hotbar UI (bottom of screen) with 9 block types selectable via 1-9 keys or scroll wheel
- Basic ambient + directional lighting with day/night cycle (optional)
- Minimap (optional)

Block types to support at minimum:
grass, dirt, stone, sand, wood, leaves, glass, brick, water

─────────────────────────────────────────
HYDRA L2 INTEGRATION (background, invisible to player)
─────────────────────────────────────────

Every block action (place or break) must be recorded as a Hydra L2 transaction, completely invisibly to the player — no wallet popups, no signing prompts, no delays.

Architecture:

1. Node.js relay server (Express + ws)
   - Accepts WebSocket connections from browser clients
   - Maintains a signing key (Ed25519) server-side — players never see it
   - On block event from browser: builds a Cardano transaction with datum encoding the block action, signs it, submits it to the Hydra node via NewTx WebSocket message
   - Listens on the Hydra node WebSocket for SnapshotConfirmed events and broadcasts world-state deltas to all connected browser clients
   - On new client connect: fetches GET /snapshot/utxo from Hydra node, decodes all block datums, sends full world state to new client so they load the current world

2. Hydra node (Docker)
   - Run a single hydra-node in offline mode (--offline-head-seed) for local dev so no real Cardano node is needed
   - Expose WebSocket on port 4001 and HTTP on port 4002
   - Zero fees (protocol-parameters.json with minFeeA=0, minFeeB=0)
   - Initial UTXO seeded with enough lovelace for thousands of transactions

3. Transaction datum format (CBOR inline datum):
   Encode each block action as a Plutus data structure:
   Constr 0 [Integer x, Integer y, Integer z, Integer blockTypeId, Integer action]
   where action: 0 = place, 1 = break
   blockTypeId: 0=grass 1=dirt 2=stone 3=sand 4=wood 5=leaves 6=glass 7=brick 8=water

4. World state reconstruction:
   - On server start or client join, iterate all UTxOs in the Hydra head
   - Decode each datum to extract block events
   - Replay them in sequence-number order to rebuild current world state
   - Send to client as a compact JSON array: [[x,y,z,blockTypeId], ...]

5. Real-time sync:
   - When Hydra emits SnapshotConfirmed, extract confirmed transactions
   - Decode datums, extract block deltas
   - Broadcast to all browser clients as: { type: "blockUpdate", x, y, z, blockTypeId, action }
   - Browser applies delta immediately to Three.js scene

─────────────────────────────────────────
PROJECT STRUCTURE
─────────────────────────────────────────

/
├── client/
│   ├── index.html
│   ├── main.js          (Three.js game entry)
│   ├── world.js         (chunk management, instanced mesh)
│   ├── player.js        (physics, camera, controls)
│   ├── raycast.js       (block selection)
│   ├── ui.js            (hotbar, crosshair, debug overlay)
│   └── hydra-client.js  (WebSocket relay client, block event sender)
├── server/
│   ├── index.js         (Express + WS relay server)
│   ├── hydra.js         (Hydra node WS client, NewTx builder)
│   ├── datum.js         (CBOR datum encode/decode)
│   └── world-state.js   (UTxO replay, world reconstruction)
├── docker/
│   └── docker-compose.yml  (hydra-node in offline mode)
├── protocol-parameters.json (zero-fee params)
└── package.json

─────────────────────────────────────────
TECHNICAL CONSTRAINTS
─────────────────────────────────────────

- Client: vanilla JS + Three.js r158 (import from CDN). No React, no bundler required for demo.
- Server: Node.js 20+, packages: ws, express, @emurgo/cardano-serialization-lib-nodejs (for CBOR datum encoding), node-fetch
- Hydra node: ghcr.io/cardano-scaling/hydra-node:latest in offline mode
- The game must be playable standalone even if the Hydra node is unreachable — block actions apply to local scene immediately, Hydra recording is fire-and-forget
- No browser wallet required — all signing happens server-side
- Target: 60fps on mid-range hardware with at least 5x5 chunks loaded

─────────────────────────────────────────
DELIVERABLES
─────────────────────────────────────────

1. All source files above, complete and runnable
2. docker-compose.yml that starts hydra-node in offline mode with seeded UTxO
3. README with:
   - npm install && npm start to run the relay
   - docker compose up to start Hydra
   - open localhost:3000 to play
4. A hydra-debug overlay (press H in-game) that shows:
   - Hydra head status (Idle / Open / Closed)
   - Total transactions submitted
   - Last confirmed snapshot sequence number
   - Current UTxO count in head

─────────────────────────────────────────
EVALUATION TARGETS
─────────────────────────────────────────

Time to generate: measure wall-clock time
Code volume: total lines across all files
Feature coverage:
  [ ] Chunked terrain rendering
  [ ] Perlin noise generation
  [ ] First-person controls + physics
  [ ] Block place / break
  [ ] Hotbar UI
  [ ] Hydra node running in offline mode
  [ ] Block actions submitted as NewTx to Hydra
  [ ] SnapshotConfirmed → world sync to all clients
  [ ] World state replay on new client join
  [ ] Hydra debug overlay (H key)
  [ ] Graceful fallback if Hydra unreachable
  [ ] Multi-client sync (open two browser tabs, break a block in one, see it break in the other)
```

## The follow-up prompts (v2 → v4, verbatim)

Each of these was a single casual message; Fable 5 scoped, built, tested and
committed each round on its own.

**v2 — game feel + prove it's real:**

> can u please make sure are you mocking the hydra? is it end to end
> implemented? i want minimap on the left bro... and also i want break
> animations and all the other stuff... think of everything you can think of
> to improve the game mechanics... and please do it for me!!!

**v3 — everything:**

> add. more game mechanics.. i want you to think of everything... all game
> mechanics.. please implement them i want to make this project the best...!!!

**v4 — mobs and the underground:**

> i want mobs.. other all stuff.. please do it.. block time mining.. all
> real minecraft

That's it. That's the whole methodology: one detailed prompt, three vibes.
