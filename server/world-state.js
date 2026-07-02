// Authoritative world-edit state, reconstructed from Hydra UTxO datums and
// kept up to date from live block events.
//
// The base terrain is procedural (same fixed seed on every client), so the
// world state is just the set of *edits*: block placed or block broken at a
// coordinate. Replaying all datums in seq order yields the current world.

export const ACTION_PLACE = 0;
export const ACTION_BREAK = 1;
export const AIR = -1;

export class WorldState {
  constructor() {
    this.edits = new Map(); // "x,y,z" -> { blockTypeId (or AIR), seq }
    this.appliedSeqs = new Set();
    this.eventCount = 0;
  }

  key(x, y, z) {
    return `${x},${y},${z}`;
  }

  // Apply one block action. Returns false if it was already applied
  // (dedup between the live relay path and the SnapshotConfirmed path).
  apply({ x, y, z, blockTypeId, action, seq }) {
    if (seq !== undefined && seq !== null && this.appliedSeqs.has(seq)) return false;
    if (seq !== undefined && seq !== null) this.appliedSeqs.add(seq);
    const value = action === ACTION_BREAK ? AIR : blockTypeId;
    this.edits.set(this.key(x, y, z), { blockTypeId: value, seq: seq ?? -1 });
    this.eventCount += 1;
    return true;
  }

  // Rebuild from a full replay (actions already sorted by seq).
  replay(actions) {
    this.edits.clear();
    this.appliedSeqs.clear();
    this.eventCount = 0;
    for (const a of actions) this.apply(a);
    console.log(`[world] replayed ${actions.length} block actions -> ${this.edits.size} edited voxels`);
  }

  // Compact form sent to newly connected clients: [[x,y,z,blockTypeIdOrAir], ...]
  toCompactArray() {
    const out = [];
    for (const [key, { blockTypeId }] of this.edits) {
      const [x, y, z] = key.split(',').map(Number);
      out.push([x, y, z, blockTypeId]);
    }
    return out;
  }
}
