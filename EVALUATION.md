# Evaluation Report — one-prompt build, Claude Fable 5

Built from a single prompt on 2026-07-02, fully autonomously (user asleep).

## Time

| metric | value |
|---|---|
| Wall-clock, prompt → verified end-to-end | **~18.5 minutes** |
| First playable render in browser | ~13 minutes |
| Human interventions | 0 |

## Cost

Exact billing isn't visible from inside the session — check `/cost` or the Console
for the real number. Rough order of magnitude for a session of this size
(~60 tool calls, heavy log output, one model): **single-digit dollars** on API
pricing. Everything ran locally (offline Hydra head, fake lovelace), so on-chain
cost is exactly **0 — and every game transaction is zero-fee by protocol parameters**.

## Code volume

**1,717 lines** total across 16 files (excluding node_modules and generated credentials):

| area | files | lines |
|---|---|---|
| Client (game) | 7 (`index.html`, `main.js`, `world.js`, `player.js`, `raycast.js`, `ui.js`, `hydra-client.js`) | 902 |
| Server (relay + Hydra) | 5 (`index.js`, `hydra.js`, `datum.js`, `world-state.js`, `setup.js`) | 627 |
| Infra + docs | `docker-compose.yml`, `protocol-parameters.json`, `package.json`, `README.md`, `.claude/launch.json` | 188 |

Dependencies: 3 runtime npm packages (`ws`, `express`, `@emurgo/cardano-serialization-lib-nodejs`;
built-in `fetch` used instead of `node-fetch`). Client is vanilla JS + Three.js r158 from CDN, no bundler.

## Feature coverage — 12 / 12

- [x] Chunked terrain rendering — 7×7 chunks of 16×16×64 (spec asked ≥5×5)
- [x] Perlin noise generation — seeded 4-octave Perlin; grass/dirt/stone/sand/water layers + procedural trees
- [x] First-person controls + physics — pointer lock, WASD, gravity, jump, AABB collision (verified: walk 3.2 blocks/600ms, jump peak +1.4, clean landing)
- [x] Block place / break — DDA raycast with face highlight, place-into-air/water rules, player-intersection guard
- [x] Hotbar UI — 9 block types, 1–9 keys + scroll wheel + click
- [x] Hydra node running in offline mode — `--offline-head-seed`, seeded 1M ADA UTxO, zero-fee params
- [x] Block actions submitted as NewTx — real signed Conway-era txs with CBOR inline datums, verified on-chain: `Constr 0 [x,y,z,blockTypeId,action,seq]`
- [x] SnapshotConfirmed → world sync — datums decoded from confirmed txs, deltas broadcast (dedup'd against the live path)
- [x] World state replay on new client join — verified: fresh client received `[[1,40,2,7],[3,30,4,-1]]`; relay restart re-replayed all actions from `GET /snapshot/utxo`
- [x] Hydra debug overlay (H key) — head status, tx submitted/valid/invalid, last snapshot #, UTxO count, queue depth
- [x] Graceful fallback if Hydra unreachable — verified: stopped the container mid-game; clients kept syncing; queued action landed on-chain (seq 2) after restart
- [x] Multi-client sync — verified twice: two WS clients (A places → B receives), and a Node "second player" placing a glass block that appeared live in the open browser tab

Extras beyond spec: day/night cycle (optional item), procedural trees, sprint,
respawn on fall, per-instance color variation, auto-reconnect on both WS hops,
`/health` endpoint, `window.__game` debug handle.

## Deviations from the spec (deliberate, documented)

1. **Datum has a 6th field `seq`** — the spec's 5-field datum can't satisfy its own
   "replay in sequence-number order" requirement, since the UTxO set is unordered.
2. **Hydra host ports 14001/14002 instead of 4001/4002** — 4001–4003 were occupied by
   another Hydra cluster already running on this machine. hydra-node serves WS and HTTP
   on one port; both mapped ports work.
3. **`local/hydra-node:2.1.0` (arm64) instead of `ghcr.io/...:latest`** on this machine —
   the upstream image is amd64-only and its embedded etcd segfaults under emulation on
   Apple Silicon. Configurable via `docker/.env`; the compose file defaults to GHCR.
4. **Relay verified on port 3100** — port 3000 was in use by another local app;
   default remains 3000 (`PORT` env overrides).

## v2 update (same day): game-feel + verifiability upgrade

Added on request ("minimap, break animations, everything you can think of"), ~1.5h autonomous:

- **Minimap** (left, M toggles): full-world top-down, height-shaded, live edits, player arrow, other players as dots
- **Break animations**: hold-to-mine with per-material hardness, 4-stage crack overlay, debris particle bursts, procedural WebAudio sounds (break/place/mine-tick/jump/splash — no asset files)
- **Multiplayer presence**: other players render as blocky avatars with name tags, 10 Hz position sync, join/leave handling
- **Swimming** (buoyancy, space to swim up, underwater fog + tint) and **fly mode** (double-tap space)
- **Held-block hand** with swing animation, walk head-bob, sprint FOV kick, place pop animation, auto-repeat place
- **On-chain activity feed** (bottom right): every SnapshotConfirmed tx scrolls by with its hash
- **`GET /chain`**: public endpoint listing every action with real L2 tx hash + raw datum CBOR ("not mocked" proof)
- H overlay now also shows last tx hash + remaining fuel; nights brightened
- All verified in-browser end to end, including an unplanned real-world fallback test: an external docker cleanup deleted the hydra-node container mid-session — the game kept running, and on `docker compose up` the relay auto-reconnected and resynced (61 UTxOs, world intact from the persistent volume)

v2 totals: **2,628 lines** across 19 files.

## v3 update: "all the game mechanics" (same day, on request)

Survival systems, world physics and ambient life — every world edit still flows
through the same relay → Hydra path:

- **Survival mode (G)**: hearts HUD, fall damage (scaled by impact), drowning
  with breath bubbles, death screen + respawn, slow regen, damage flash +
  camera shake; mined blocks drop as spinning item entities with magnet
  pickup; placing consumes inventory (counts on the hotbar, 8 starter TNT)
- **TNT (block id 9, hotbar 0)**: punch to ignite, blinking 2.2 s fuse,
  sphere blast, knockback + blast damage, chain reactions — verified live: a
  2-TNT chain produced **37 on-chain transactions, 0 invalid** in one burst
- **Falling sand**: unsupported sand falls (mining, explosions, placing over
  air), animated, re-recorded on-chain as break@top + place@bottom
- **Sheep** (6): wander terrain avoiding water/cliffs, punchable with
  knockback + bleat; simulated by the relay-elected host client, synced to
  everyone, shown on the minimap
- **Third person (F5)** with own avatar + wall-aware camera, **sneak** (shift:
  slow, low camera, edge-guard), **sprint** (double-tap W / Ctrl),
  **middle-click block picking**, hold-to-repeat placing
- **Chat (T)** via the relay with per-client rate limiting
- **Sky**: sun + moon billboards tracking the cycle, stars fading in at
  night, drifting clouds; footstep sounds by surface, day birdsong, wind bed
- 10-slot hotbar (1-9, 0), TNT canvas texture, death/hurt/explosion/fuse/
  bleat procedural sounds

v3 verification (all in-browser, real relay + hydra-node): mine→drop→pickup→
place-consume loop; 12-block fall → 9 HP, 40-block fall → death → respawn;
16 s underwater → 15 drowning damage; sand tower collapse; TNT chain
explosion on-chain (records 74 → 111); sheep wander + knockback; chat
round-trip; third-person camera pullback 4.0 with self-avatar. v3 totals:
**3,779 lines** across 22 files.

## v4 update: mobs + underground ("all real minecraft", /goal request)

- **Zombies**: spawn after dark (≤6, min 14 blocks from players), chase any
  player within 24 blocks at 2.3 blocks/s, bite for 3 damage + knockback on a
  1 s cooldown, groan when near, die to 5 punches (poof), burn off at dawn.
  Verified: chase closed 10.0 → 0.9 blocks; two bites in 1.65 s → 6 damage.
- **Passive mob variety**: 3 sheep, 2 pigs, 2 cows, 1 chicken with distinct
  blocky models and per-species health (chicken 2 … cow 4); punchable with
  knockback; host-simulated, state-synced, dead/despawned mobs removed on all
  clients.
- **Caves**: 3D-value-noise worm tunnels under all dry land (~11k air cells
  in a quarter-sample of the map) with an automatic miner's headlamp
  (bright underground, soft at night, off in daylight).
- **Ores**: coal/iron/gold/diamond (ids 10-13) in coarse-hash veins, rarity
  and depth ordered — sampled 1437/1065/458/207 — speckle-textured, minable
  and collectable in survival (verified diamond: mine → drop → magnet pickup
  → hotbar count).
- **Real per-block mining times** from `BLOCKS[].hardness` — measured exact:
  dirt 0.51 s (spec 0.5), stone 1.50 s (1.5), diamond ore 3.01 s (3.0).
- 14-slot hotbar (ores selectable via scroll/click/middle-click pick).

## End-to-end verification summary (all passed)

1. Offline head opens; seeded UTxO visible via `GET /snapshot/utxo`.
2. Two block actions → 2 `TxValid`, snapshot advanced, 2 datums on-chain with correct fields.
3. New WS client receives the full edit set on join.
4. Relay restart → world rebuilt from head UTxOs, fuel re-located (999,998 ADA remaining).
5. Hydra stopped → gameplay + multi-client sync unaffected; on restart, queued tx confirmed on-chain.
6. Browser: 60 fps, terrain/water/trees render, physics verified, H overlay live
   (head Open, snapshot #8, 9 UTxOs), on-chain state survives page reload.
7. Final ledger state: 5 txs from this session valid, 0 invalid, 8 block records in the head.
