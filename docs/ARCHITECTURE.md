# Architecture — how a Minecraft clone became a Cardano L2 app

This document explains what was actually built: a browser voxel game whose
entire edit history lives as **real, signed, zero-fee Cardano transactions**
inside a Hydra head, invisible to the player.

## The one-line idea

The procedural terrain is a pure function of a fixed seed, so the *world* never
needs storing — only the *edits* do. Every place/break is therefore a tiny
event (`x, y, z, blockType, action, seq`) small enough to be a transaction
datum, and the Hydra head's UTxO set becomes the world's save file.

## System diagram

```
┌─────────────────────┐   ws (blockEvent, pos, chat, mobs)   ┌──────────────────────┐
│  Browser client(s)  │ ───────────────────────────────────► │   Relay server       │
│  Three.js game      │ ◄─────────────────────────────────── │   Node.js            │
│  client/*.js        │   worldState, blockUpdate,           │   server/index.js    │
│                     │   txConfirmed, hydraStats,           │                      │
│  - terrain from     │   playerPos, mobs, chat              │  - Ed25519 key       │
│    fixed seed       │                                      │  - builds + signs tx │
│  - edits overlay    │                                      │  - world edit cache  │
└─────────────────────┘                                      └──────┬───────────────┘
                                                                    │ ws NewTx (CBOR tx)
                                                                    │ ws SnapshotConfirmed
                                                                    │ http GET /snapshot/utxo
                                                             ┌──────▼───────────────┐
                                                             │  hydra-node (Docker) │
                                                             │  offline mode        │
                                                             │  --offline-head-seed │
                                                             │  zero-fee params     │
                                                             └──────────────────────┘
```

## Transaction lifecycle

1. Player breaks a block. The client applies it locally at once (no latency),
   then fire-and-forgets `{type:"blockEvent", x,y,z,blockTypeId,action}` to
   the relay.
2. The relay applies it to its authoritative edit map, broadcasts a
   `blockUpdate` to every *other* client immediately (multiplayer does not
   wait for the chain), and queues the on-chain record.
3. `server/hydra.js` builds a Conway-era transaction with
   cardano-serialization-lib:
   - **input**: the relay's current *fuel* UTxO
   - **output 0**: a 1 ADA *record* output carrying the inline datum
     `Constr 0 [x, y, z, blockTypeId, action, seq]` — never spent again, so
     the UTxO set accumulates the full ordered log
   - **output 1**: fuel change, optimistically chained as the next input
4. It signs with the server-side Ed25519 key (players never see keys or
   popups) and submits via the Hydra WebSocket `NewTx`. `TxValid` advances
   the queue; `TxInvalid`/timeout re-syncs fuel from a fresh snapshot.
5. Hydra confirms a snapshot → the relay decodes the confirmed transactions'
   datums and broadcasts `txConfirmed` receipts (tx hash + snapshot number)
   that feed the in-game activity feed, deduplicating against step 2 so
   worlds never double-apply.

## World state reconstruction

- On relay start **or** any client join, `GET /snapshot/utxo` returns the
  head's UTxO set; every inline datum is decoded and sorted by `seq`
  (the 6th field exists precisely because a UTxO set is unordered).
- The result is a compact edit list `[[x,y,z,blockTypeIdOr-1], ...]` applied
  over the seed-generated terrain. Restarting the relay, refreshing the
  browser, or joining from a second machine all rebuild the identical world.
- `GET /chain` exposes the same data as an explorer: every action with its
  real L2 transaction hash and raw datum CBOR.

## What is (and isn't) on-chain

| on-chain (blockEvent → tx) | off-chain (relay-synced only) |
|---|---|
| player place/break | player positions, avatars |
| every block a TNT explosion destroys | mobs (sheep/pigs/cows/chickens/zombies) |
| falling-sand break@top + place@bottom | item drops, particles, sounds |
| | chat, day/night, clouds |

Rule of thumb: **world edits are ledger facts; ambience is not.** Physics is
simulated by the *client that caused it* and re-enters the pipeline as plain
block events, so replay never needs a physics engine.

## Multiplayer

- The relay assigns ids (`steve-N`), rebroadcasts 10 Hz positions, chat
  (rate-limited), and elects the lowest-id client as **mob simulation host**
  (with failover on disconnect). The host runs all mob AI against its local
  voxel world and broadcasts state at ~6 Hz; punches route through the relay
  to the host.
- If the Hydra node is unreachable, gameplay and multiplayer continue
  untouched; queued actions land on-chain when it returns. This was verified
  by killing the container mid-game — twice, once unplanned.

## Module map

| file | role |
|---|---|
| `client/world.js` | seeded Perlin terrain, caves (3D value noise), ore veins, chunked InstancedMesh rendering |
| `client/player.js` | pointer-lock camera, AABB physics, sneak/sprint/fly/swim, breath |
| `client/raycast.js` | Amanatides-Woo DDA block targeting + highlight |
| `client/main.js` | game loop; mining/TNT/falling sand; health/survival; wiring |
| `client/mobs.js` | 5 mob species, host-simulated AI, zombie hostility |
| `client/effects.js` | particles, crack stages, procedural WebAudio sounds |
| `client/items.js`, `sky.js`, `minimap.js`, `players.js`, `ui.js`, `hydra-client.js` | drops, sky, map, avatars, HUD, relay socket |
| `server/index.js` | Express static + ws relay, broadcast, host election, `/chain`, `/health` |
| `server/hydra.js` | Hydra ws client, tx build/sign/chain, snapshot decode, fuel management |
| `server/datum.js` | CBOR datum encode/decode (CSL) |
| `server/world-state.js` | edit map, seq dedup, replay |
| `server/setup.js` | dev key + genesis UTxO generation |
| `docker/docker-compose.yml` | hydra-node in offline mode, persistent volume |

## Numbers that matter

- A single TNT explosion is a burst of ~30–80 real L2 transactions; a
  verified 2-TNT chain produced **37 valid / 0 invalid** in one shot —
  optimistic tx chaining kept up without breaking a sweat.
- The head was seeded with 1M (offline) ADA; each record costs 1 ADA, so the
  world has fuel for ~a million edits before re-seeding.
- Mining times, mob stats, ore rarity: see `client/world.js` (`BLOCKS`) and
  `client/mobs.js` (`MOB_TYPES`) — they are data, not code.

## Ops cheatsheet

```bash
npm run setup      # keys + genesis UTxO (once)
npm run hydra:up   # hydra-node on ports 14001/14002 (see docker/.env)
npm start          # relay + game on :3000 (PORT=... to change)

curl localhost:3000/health           # relay + head status
curl localhost:3000/chain | jq       # the entire world history, tx by tx
docker compose -f docker/docker-compose.yml down -v   # wipe the chain = fresh world
```
