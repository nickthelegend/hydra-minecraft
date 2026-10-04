---
format: 1920x1080
message: "A Minecraft world where every block is a real Cardano L2 transaction — and you never notice."
arc: Future Pacing → mechanism → demo loop → wow stat → built-by → CTA
audience: Cardano/web3 devs, crypto-curious gamers, AI dev-tools crowd
music: "minimal electronic, premium, understated warm pulse, no big drop, low-key confident"
music_volume: 0.05
sfx_volume: 0.2
---

## Video direction

- **Palette system** (from `frame.md`): canvas `cream #0B0F14` (near-black night) full-bleed on every frame; body/heading text `ink #F2E7D5` (TNT-paper warm) with `ink-2 #D9CD8E` (sand) for sub-lines; primary accent `green #59A832` (grass) for the key word / hero highlight; secondary accent `pink #7FB4FF` (hydra blue) for anything on-chain (tx, ledger, L2); `orange #D94534` (TNT red) reserved for the destructive/explosive beat and one CTA verb. Pixel display = Press Start 2P (`display-*`, `step-*`); readouts/mono = VT323 (`body-*`, `mono-*`). 4px `ink`-adjacent borders + hard offset shadows (no blur) are the pack's signature — every card/stat tile is a bordered voxel-ish block.
- **Motion grammar + reveal model**: long-tail eases (`power3` default — smooth, never bouncy except one spring-pop payoff per type frame). Strictly **VO-paced**: at t=0 only what the narrator is saying enters; each further line/card/stat reveals exactly when the voice names it (word timings drive the cues), weighted into the back half. Blocky reveals fit the theme — pieces **snap/pop in** on a hard cut or short pop, like placing a Minecraft block, rather than soft fades. During holds: at most a 1–2px idle jitter on the hero; no drifting, no breathing.
- **Rhythm / held-frame allocation**: Frames 2 (hero reveal) and 4 (the on-chain proof) are the **held reads** — content resolves, then sits still so the viewer absorbs the real HUD. Frames 1, 6, 8 are kinetic type. Frame 3 is a continuous pan. Frames 5, 7, 9 build then hold briefly.
- **SFX**: a single soft UI **click** on each frame's entrance transition only (20% mix) — NO ticking, NO per-element clicks. BGM is a low 5% warm pulse under everything.
- **Negative list**: no white (#FFFFFF) fields or pure-black (#000000) type; no soft glows/bokeh/purple-AI gradients; no rounded pill chrome (square voxel corners only); no browser chrome/cursors except inside the real screenshots; never front-load (slideshow) and never let everything float independently (screensaver). The game screenshots are the only photographic elements — everything else is type + bordered blocks.

## Frame 1 — Hook

- type: hook
- scene: Bold pixel type builds the question beat by beat; one word swaps to land the twist
- duration: 4.245s
- transition_in: cut
- status: animated
- src: compositions/frames/01-hook.html
- blueprint: kinetic-type-beats (Reproduce)
- focal: none (pure type on dark canvas)
- roles: voxel-cube accents = supporting
- voiceover: "What if every block you placed... was a real blockchain transaction?"
- asset_candidates: none (pure type on dark canvas, voxel cube accents)
- sfx: click (entrance)

Cold open. Dark night canvas, Press Start 2P. The swap-in-place IS the hook —
"BLOCK" holds while "you placed" resolves into the on-chain twist.

Scene 1 (0.0–1.4s): on `cream` canvas, "WHAT IF EVERY **BLOCK**" types/snaps in centered, `display-lg`, ink with BLOCK in `green` — Centered, ~60% width, upper-third weighted. Two small grass/blue voxel cubes sit in the lower corners, still. Signature move armed: the last token will swap.
Scene 2 (1.4–2.6s): "YOU PLACED…" snaps in beneath on its spoken cue, ink, `display-head` — the line now reads as a whole. Slight hold.
Scene 3 (2.6–4.245s): on "real blockchain transaction," the tail line **hard-cuts/swaps** to "WAS A REAL **BLOCKCHAIN TRANSACTION**?" — BLOCKCHAIN TRANSACTION in `pink` (hydra blue), spring-pop once, then dead still. The two voxel cubes nudge 2px on the pop. Held to end.

## Frame 2 — Product intro

- type: product_intro
- scene: The game vista reveals full-bleed; title lockup + tagline over the big sky
- duration: 6.613s
- transition_in: wipe
- status: animated
- src: compositions/frames/02-intro.html
- blueprint: device-surface-showcase (Reproduce)
- focal: assets/game-vista.png
- roles: game-vista.png = background (full-bleed, held ~90%; NOT dimmed — it's the hero)
- voiceover: "This is Hydra Minecraft. A voxel world in your browser — running on Cardano's Hydra layer two."
- asset_candidates: game-vista.png (HERO — huge sky safe zone for type)
- sfx: click (entrance)

The real gameplay hero shot is the payload. This is a held read — the
screenshot proves the game is real; type sits in the sky safe zone.

Scene 1 (0.0–1.6s): the vista wipes in full-bleed and holds (a barely-there 1.02 slow scale, no pan). On "This is Hydra Minecraft," the name lockup snaps into the sky upper-left: "HYDRA" / "MINECRAFT" stacked, `display-lg`, ink with a hard `ink` drop-shadow block so it reads on the sky — left-thirds, ~34% width.
Scene 2 (1.6–4.0s): on "voxel world in your browser," a `mono-label` sub-line snaps in under the lockup: "A VOXEL WORLD IN YOUR BROWSER" in `ink-2`. Everything else holds still — the world does the talking.
Scene 3 (4.0–6.613s): on "Cardano's Hydra layer two," a small square badge pops at the lockup's baseline — "CARDANO · HYDRA L2" in `pink` on a bordered block. Then fully still, held read to end.

## Frame 3 — Mechanism

- type: feature_showcase
- scene: Three stations panned left to right: BROWSER → RELAY → HYDRA HEAD; zero-fee badges land
- duration: 7.829s
- transition_in: cut
- status: animated
- src: compositions/frames/03-mechanism.html
- blueprint: spatial-pan-stations (Reproduce)
- focal: none (diagram of three bordered station blocks on a wide canvas)
- roles: station blocks = cutout · connecting line = supporting
- voiceover: "No wallet. No popups. No fees. A relay signs every action into an offline Hydra head — invisibly."
- asset_candidates: none (diagram frame: pixel-bordered station cards, block icons)
- sfx: click (entrance)

How-it-works as a single-camera lateral pan across three bordered voxel
stations. The three "no" jabs stamp first, then the pan travels the pipeline.

Scene 1 (0.0–1.8s): three "NO WALLET · NO POPUPS · NO FEES" stamps hard-cut in one per spoken cue, centered, `step-title`, each on a small `orange`-bordered block that then knocks back to reveal the pipeline behind — full-width strip.
Scene 2 (1.8–3.6s): camera sits on Station 1 "YOUR BROWSER" (a bordered block with a green grass-cube icon + a click mark), `mono-label` caption, left of a wide canvas. A dashed `pink` connector line runs rightward off-frame.
Scene 3 (3.6–5.6s): on "a relay signs every action," pan right centering Station 2 "RELAY" — bordered block, "SIGNS Ed25519" `mono-label`, a small `pink` tx-pill pops on the connector as it passes.
Scene 4 (5.6–7.829s): on "offline Hydra head — invisibly," pan right to Station 3 "HYDRA HEAD" — `pink`-bordered block, "ZERO-FEE L2" + a tiny UTxO stack icon; a `green` "✓ INVISIBLE" chip pops and holds. Camera settles, still.

## Frame 4 — Proof on screen

- type: feature_showcase
- scene: The overlay screenshot held as hero; callout brackets pin the H overlay and the tx feed
- duration: 7.296s
- transition_in: crossfade
- status: animated
- src: compositions/frames/04-proof.html
- blueprint: device-surface-showcase (Reproduce)
- focal: assets/game-overlay.png
- roles: game-overlay.png = background (full-bleed hero, held; slight dim ~15% only where callout text overlaps empty sky)
- voiceover: "Press H. Head status, snapshots, fuel — and every confirmed transaction scrolling by, hash by hash."
- asset_candidates: game-overlay.png (H overlay top-right, on-chain feed bottom-right)
- sfx: click (entrance)

THE proof shot — held read. Real HUD with the live Hydra overlay + tx feed;
pixel brackets pin the two regions as the VO names them. No motion on the
screenshot itself.

Scene 1 (0.0–1.4s): overlay screenshot crossfades in full-bleed and holds. On "Press H," a `green` key-cap block "[H]" pops bottom-center, `step-title`.
Scene 2 (1.4–4.2s): on "head status, snapshots, fuel," a `pink` bracket draws around the top-right HYDRA L2 overlay and three `mono-label` tags snap beside it one per word — "STATUS" / "SNAPSHOTS" / "FUEL" — pointing in. Screenshot stays still.
Scene 3 (4.2–7.296s): on "every confirmed transaction scrolling by," a second `pink` bracket draws around the bott-right tx feed, label "ON-CHAIN, HASH BY HASH" in `ink`; a tiny `green` underline sweeps the feed once. Then fully still, held to end.

## Frame 5 — Mining

- type: feature_showcase
- scene: Mining screenshot held; a crack-stage hardness bar fills; "3.0s DIAMOND" stamp lands
- duration: 5.803s
- transition_in: cut
- status: animated
- src: compositions/frames/05-mining.html
- blueprint: video-text-pivot (Adapt)
- focal: assets/game-mine.png
- roles: game-mine.png = cutout (held right ~62%) · hardness bar = supporting
- voiceover: "Hold to mine. Real block hardness, crack by crack — diamonds take three full seconds."
- asset_candidates: game-mine.png (crack overlay on diamond ore, hand mid-swing)
- sfx: click (entrance)

Adapt video-text-pivot: the screenshot doesn't slide out — it stays as proof
while a hardness meter fills beside it and pivots to the "3.0s" stamp.

Scene 1 (0.0–1.4s): mining screenshot cuts in, held right 62%. On "Hold to mine," a `mono-label` "HOLD TO MINE" snaps top-left.
Scene 2 (1.4–3.6s): on "crack by crack," a vertical stack of four bordered crack-stage blocks fills bottom-to-top on the left third, `green`, each snapping on a beat — a voxel progress bar.
Scene 3 (3.6–5.803s): on "three full seconds," a big `pink` stamp "3.0s" `stat-num` slams in over the left third with "DIAMOND" `mono-label` beneath; the crack bar tops out `green`. Hold still to end.

## Frame 6 — TNT, the wow stat

- type: benefit_highlight
- scene: TNT screenshot slides aside; a giant 37 counts up; "one blast · zero invalid" seals it
- duration: 5.845s
- transition_in: cut
- status: animated
- src: compositions/frames/06-tnt.html
- blueprint: video-text-pivot (Reproduce)
- focal: assets/game-tnt.png
- roles: game-tnt.png = cutout (enters full, slides to right ~45%) · 37 stat = hero
- voiceover: "TNT chain reactions? Thirty-seven transactions. One blast. Zero invalid."
- asset_candidates: game-tnt.png (TNT centered in crosshair, TNT in hand)
- sfx: click (entrance)

The demo becomes data — the L2 throughput flex. Screenshot slides, hands its
weight to a count-up.

Scene 1 (0.0–1.3s): TNT screenshot cuts in full-bleed. On "TNT chain reactions?", it slides left-to-right settling at right ~45%, vacating the left.
Scene 2 (1.3–3.0s): on "Thirty-seven transactions," a giant `orange` (TNT-red) "37" count-ups 0→37 in the vacated left, `stat-num`→`display-xl`, hard offset shadow; "TRANSACTIONS" `mono-label` snaps beneath in `ink`.
Scene 3 (3.0–5.845s): on "One blast. Zero invalid," two stacked bordered chips pop beneath — "ONE BLAST" (`ink`) and "0 INVALID" (`green`) — one per cue. Tiny TNT-red voxel debris flecks pop on the "37" and settle. Hold still.

## Frame 7 — The world

- type: benefit_highlight
- scene: Three gameplay cards cascade in — cave, zombie night, multiplayer — and hold as a triptych
- duration: 5.888s
- transition_in: wipe
- status: animated
- src: compositions/frames/07-world.html
- blueprint: grid-card-assemble (Reproduce)
- focal: assets/game-night.png
- roles: game-cave.png = supporting · game-night.png = cutout (center, largest) · game-multi.png = supporting
- voiceover: "Caves. Zombies after dark. Friends in the same world — on a ledger that never forgets."
- asset_candidates: game-cave.png, game-night.png, game-multi.png
- sfx: click (entrance)

Three bordered gameplay cards self-assemble as a triptych, one per named
beat, then a ledger line lands warm.

Scene 1 (0.0–1.2s): on "Caves," the cave card snaps into the left third, bordered block + `mono-label` "CAVES & ORES" — triptych, ~30% each.
Scene 2 (1.2–2.4s): on "Zombies after dark," the night/zombie card snaps into the center, slightly larger/forward, label "SURVIVAL NIGHTS" in `orange`.
Scene 3 (2.4–3.8s): on "Friends in the same world," the multiplayer card snaps into the right third, label "MULTIPLAYER" in `pink`. Triptych complete, holds.
Scene 4 (3.8–5.888s): on "a ledger that never forgets," a full-width `pink` underline sweeps beneath all three and the caption "EVERY EDIT ON-CHAIN" types in centered below, `body-lg` ink. Still hold to end.

## Frame 8 — Built by

- type: branding
- scene: Bare canvas; the claim lands line by line, "one prompt" gets the accent block
- duration: 5.248s
- transition_in: cut
- status: animated
- src: compositions/frames/08-builtby.html
- blueprint: kinetic-type-beats (Reproduce)
- focal: none (pure type)
- roles: stat chips = supporting
- voiceover: "Built end to end by Claude Fable 5 — from one prompt, while its author slept."
- asset_candidates: none (pure type)
- sfx: click (entrance)

The origin-story flex, understated. Lots of dark space, quiet confidence.

Scene 1 (0.0–2.2s): on "Built end to end by Claude Fable 5," "BUILT END TO END BY" snaps in small `mono-kicker` `ink-2` centered upper, then "CLAUDE FABLE 5" slams beneath it `display-lg` in `green` — Centered, upper-third.
Scene 2 (2.2–3.6s): on "from one prompt," a single bordered `green` block "ONE PROMPT" pops center, `step-title` ink-on-green — the accent-block payoff.
Scene 3 (3.6–5.248s): on "while its author slept," a `mono-label` sub-line types in beneath — "18 MINUTES · 12/12 FEATURES · 0 HUMANS AWAKE" in `ink-2`. Hold still.

## Frame 9 — CTA

- type: cta
- scene: Voxel cube logo assembles; URL types in beneath; final hold on the lockup
- duration: 3.371s
- transition_in: crossfade
- status: animated
- src: compositions/frames/09-cta.html
- blueprint: logo-assemble-lockup (Reproduce)
- focal: none (voxel cube mark built from brand-color blocks)
- roles: voxel cube mark = cutout · URL = supporting
- voiceover: "Clone it. Run it. Mine on-chain. Hydra Minecraft."
- asset_candidates: none (voxel cube mark built from brand-color blocks)
- sfx: click (entrance)

Snappy sign-off — a voxel mark assembles, three imperatives stamp, the name
locks up, URL types.

Scene 1 (0.0–1.4s): on "Clone it. Run it. Mine on-chain," three tiny bordered chips stamp left-to-right center — "CLONE" / "RUN" / "MINE ON-CHAIN" (last in `orange`) — while a 3×3 voxel cube mark assembles block-by-block (grass green / hydra blue / brick red) to their left.
Scene 2 (1.4–2.4s): on "Hydra Minecraft," the chips clear and "HYDRA MINECRAFT" locks up center beside the finished cube, `display-lg` ink with hard shadow.
Scene 3 (2.4–3.371s): `github.com/nickthelegend/hydra-minecraft` types in beneath in `mono-label` `pink`. Hold to end.
