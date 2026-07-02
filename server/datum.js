// CBOR inline-datum encode/decode for block actions.
//
// Datum shape (Plutus data):
//   Constr 0 [Integer x, Integer y, Integer z, Integer blockTypeId, Integer action, Integer seq]
//
// action: 0 = place, 1 = break
// blockTypeId: 0=grass 1=dirt 2=stone 3=sand 4=wood 5=leaves 6=glass 7=brick 8=water
// seq: monotonically increasing sequence number so world state can be
//      replayed deterministically from the unordered UTxO set.

import CSL from '@emurgo/cardano-serialization-lib-nodejs';

function plutusInt(n) {
  return CSL.PlutusData.new_integer(CSL.BigInt.from_str(String(n)));
}

export function encodeBlockActionDatum({ x, y, z, blockTypeId, action, seq }) {
  const fields = CSL.PlutusList.new();
  for (const v of [x, y, z, blockTypeId, action, seq]) fields.add(plutusInt(v));
  const constr = CSL.ConstrPlutusData.new(CSL.BigNum.from_str('0'), fields);
  return CSL.PlutusData.new_constr_plutus_data(constr);
}

export function decodeBlockActionDatum(plutusData) {
  const constr = plutusData.as_constr_plutus_data();
  if (!constr) return null;
  if (constr.alternative().to_str() !== '0') return null;
  const fields = constr.data();
  if (fields.len() < 5) return null;
  const ints = [];
  for (let i = 0; i < fields.len(); i++) {
    const int = fields.get(i).as_integer();
    if (!int) return null;
    ints.push(parseInt(int.to_str(), 10));
  }
  const [x, y, z, blockTypeId, action] = ints;
  const seq = ints.length >= 6 ? ints[5] : 0;
  return { x, y, z, blockTypeId, action, seq };
}

export function decodeBlockActionDatumHex(hex) {
  try {
    return decodeBlockActionDatum(CSL.PlutusData.from_hex(hex));
  } catch {
    return null;
  }
}

// Hydra's /snapshot/utxo returns inline datums as detailed JSON schema
// (inlineDatum: {constructor: 0, fields: [{int: ...}, ...]}). Support both.
export function decodeBlockActionDatumJson(json) {
  try {
    if (!json || json.constructor !== 0 || !Array.isArray(json.fields)) return null;
    const ints = json.fields.map((f) => {
      if (typeof f.int === 'number') return f.int;
      if (typeof f.int === 'string') return parseInt(f.int, 10);
      return null;
    });
    if (ints.length < 5 || ints.some((v) => v === null || !Number.isFinite(v))) return null;
    const [x, y, z, blockTypeId, action] = ints;
    const seq = ints.length >= 6 ? ints[5] : 0;
    return { x, y, z, blockTypeId, action, seq };
  } catch {
    return null;
  }
}
