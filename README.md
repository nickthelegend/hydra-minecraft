# Hydra Minecraft

A fully playable Minecraft-style voxel game in the browser (Three.js), where **every
block you place or break is recorded as a real Cardano transaction on a Hydra L2
head** — invisibly, with no wallet, no popups, and no delays.

Built end to end by **Claude Fable 5** from a single prompt (then three casual
follow-ups for survival, TNT, mobs, caves and ores). See
[PROMPT.md](PROMPT.md) for the exact prompts and how to rebuild it yourself,
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it works, and
[EVALUATION.md](EVALUATION.md) for the build-time/verification scoreboard.

![architecture](#architecture)

```
browser (Three.js game) ──ws──> relay server (Express + ws, signs txs) ──ws──> hydra-node (offline head)
        ^                            |    NewTx (CBOR, inline datum)              |
        └── blockUpdate deltas ──────┴──── SnapshotConfirmed / GET /snapshot/utxo ┘
```

## Quick start

```bash
npm install
npm run setup      # generates dev keys + the initial UTxO for the offline head
npm run hydra:up   # docker compose: starts hydra-node in offline mode
npm start          # relay server; open http://localhost:3000 to play
```

- **Port 3000 busy?** `PORT=3100 npm start` (the game is served from whatever port the relay uses).
- **Stop Hydra:** `npm run hydra:down` — the game stays fully playable; actions queue
  and are recorded on-chain when the node comes back.

### Controls

| input | action |
|---|---|
| click | capture mouse (pointer lock) |
| WASD / mouse | move / look |
| space | jump (swim up in water) |
| **shift** | sneak: slow, lowered camera, can't walk off edges (descend in fly mode) |
| **double-tap W** (or Ctrl) | sprint with FOV kick |
| **double-tap space** | toggle fly mode (space up, shift down; landing exits) |
| **hold left click** | mine block (crack stages + debris particles; hardness per material) |
| left click on TNT | **ignite it** (2.2 s fuse, blinking, chain reactions) |
| left click on a sheep | punch it (knockback, bleat) |
| right click (hold to repeat) | place block |
| middle click | pick the block you're looking at |
| 1–9, 0 or scroll | select block (grass, dirt, stone, sand, wood, leaves, glass, brick, water, TNT) |
| **G** | toggle **survival mode**: hearts, fall/drowning damage, death & respawn, block drops with magnet pickup, placing consumes inventory (8 starter TNT) |
| **F5** | third-person camera (see your own avatar) |
| **T** | chat with other players |
| **M** | toggle minimap (top-down world map, player arrow, other players) |
| **H** | **Hydra debug overlay** (head status, tx counts, last snapshot + tx hash, UTxO count, fuel) |

Multiplayer: open a second tab/browser — other players appear as blocky avatars
with name tags, live position sync at 10 Hz, chat, and every player's confirmed
transactions scroll through the on-chain activity feed (bottom right). Six
sheep wander the world (simulated by the first-connected client, relayed to
everyone; punchable).

World physics that ends up on-chain: **TNT explosions** break every block in
the blast radius as individual Hydra transactions (a single explosion is a
~30-80 tx burst — a nice L2 throughput demo), chain-react with nearby TNT and
trigger **falling sand**, which is re-recorded as break-at-top + place-at-
bottom by the client that caused it. Ambient life (mobs, item drops, clouds)
is deliberately *not* recorded — only world edits are.

### Underground & mobs (v4)

- **Caves**: worm-like tunnel systems carved by 3D value noise under all dry
  land — bring the auto-headlamp (it brightens underground and at night).
- **Ores** (block ids 10-13): coal, iron, gold and diamond veins, rarer and
  deeper in that order, with speckled textures; mine them in survival to
  collect (they're placeable like any block).
- **Real per-block mining times** (`BLOCKS[].hardness`): dirt/sand 0.5 s,
  grass 0.6 s, leaves 0.2 s, glass 0.3 s, stone 1.5 s, wood/brick/coal 2 s,
  iron 2.5 s, gold/diamond 3 s.
- **Mobs**: sheep, pigs, cows and chickens wander by day (8 total, each with
  hearts of their own — punch a chicken twice and it poofs). **Zombies spawn
  after dark** (up to 6), hunt any player within 24 blocks, bite for 3 damage
  with knockback, burn off at dawn, and die to 5 punches. All simulated by
  the relay-elected host client and synced to everyone.

### Verifying it's real (not mocked)

- `GET /chain` on the relay (e.g. http://localhost:3000/chain) lists **every
  block action with its real L2 transaction hash and raw datum CBOR**, read
  live from the hydra-node's `GET /snapshot/utxo`.
- `docker exec <container> hydra-node --version` — it's the upstream binary.
- Stop the container: the game keeps running but confirmations stop and the
  queue counter grows; start it again and the queue drains on-chain.
- Decode any `datumCbor` yourself, e.g. `d8799f0e181b18260001181dff` →
  `Constr 0 [14, 27, 38, 0, 1, 29]` = "break grass at (14,27,38), seq 29".

## How the Hydra integration works

- The relay holds an Ed25519 signing key server-side (`docker/credentials/payment.sk`,
  generated by `npm run setup`). Players never sign anything.
- The offline head is seeded with a single 1,000,000 ADA UTxO at the relay's address
  (`docker/credentials/utxo.json`) — enough for hundreds of thousands of actions.
- Each block action becomes a zero-fee transaction (protocol-parameters.json has
  `txFeeFixed = txFeePerByte = utxoCostPerByte = 0`) that spends the relay's "fuel"
  UTxO and produces:
  - a 1 ADA **record output** carrying the action as a CBOR **inline datum**, never
    spent again — so the head's UTxO set is the complete, replayable action log;
  - a fuel **change output**, spent by the next action (optimistic tx chaining).
- Datum shape: `Constr 0 [Integer x, Integer y, Integer z, Integer blockTypeId, Integer action, Integer seq]`
  with `action` 0=place / 1=break, `blockTypeId` 0=grass 1=dirt 2=stone 3=sand 4=wood
  5=leaves 6=glass 7=brick 8=water 9=TNT 10=coal-ore 11=iron-ore 12=gold-ore
  13=diamond-ore. The 6th field (`seq`) extends the base 5-field spec so the
  unordered UTxO set can be replayed deterministically (ids 9-13 also extend
  the original 0-8 table).
- On `SnapshotConfirmed`, the relay decodes the confirmed transactions' datums and
  broadcasts world deltas to all clients; live edits are also broadcast immediately so
  multiplayer stays snappy (and keeps working if Hydra is down).
- On relay start or client join, `GET /snapshot/utxo` is decoded and replayed in
  `seq` order to rebuild the world. Terrain is procedural with a fixed seed
  (identical on every client), so only the *edits* live on-chain.

## Project layout

```
client/            vanilla JS + Three.js r158 from CDN (no bundler)
  main.js          entry: scene, day/night, input glue
  world.js         Perlin terrain, chunk storage, InstancedMesh rendering
  player.js        pointer-lock camera, WASD, gravity, AABB collisions
  raycast.js       DDA voxel raycast + block highlight
  ui.js            hotbar, crosshair, debug + hydra overlays
  hydra-client.js  relay WebSocket client (fire-and-forget, auto-reconnect)
server/
  index.js         Express static + WS relay, broadcast, dedup
  hydra.js         hydra-node WS client, tx build/sign/submit, snapshot handling
  datum.js         CBOR inline-datum encode/decode (cardano-serialization-lib)
  world-state.js   edit map, UTxO replay, compact world-state serialization
  setup.js         dev key + initial-UTxO generation
docker/
  docker-compose.yml   hydra-node in offline mode (--offline-head-seed)
protocol-parameters.json  zero-fee ledger params (from hydra-cluster config)
```

## Notes & troubleshooting

- **Apple Silicon:** the upstream `ghcr.io/cardano-scaling/hydra-node` image is
  amd64-only and its embedded etcd crashes under emulation. Set `HYDRA_IMAGE` in
  `docker/.env` to a native arm64 build (this repo's `.env` points at
  `local/hydra-node:2.1.0`). On amd64 hosts, delete `docker/.env`.
- Hydra's API serves WebSocket **and** HTTP on the same port; host ports default to
  `14001` (and `14002` as an HTTP alias) to avoid clashing with other local Hydra
  setups. Override with `HYDRA_WS_PORT`/`HYDRA_HTTP_PORT` (compose) and
  `HYDRA_HOST`/`HYDRA_PORT` (relay).
- Head state persists in the `hydra-data` docker volume — restart the container and
  the world survives. `docker compose -f docker/docker-compose.yml down -v` wipes the
  chain (fresh world).
- Everything here is dev-mode: offline head, fake lovelace, generated throwaway keys.
