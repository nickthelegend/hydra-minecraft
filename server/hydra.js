// Hydra node client: WebSocket connection, transaction building/signing,
// NewTx submission, SnapshotConfirmed handling and fuel-UTxO management.
//
// Every block action becomes a zero-fee Cardano transaction inside the
// offline Hydra head:
//   input : the relay's current "fuel" UTxO
//   output0: 1 ADA "record" output carrying the block-action inline datum
//            (never spent again, so the full action log stays in the UTxO set)
//   output1: fuel change, spent by the next action (tx chaining)
//
// Everything is signed with the relay's server-side Ed25519 key; browser
// clients never see keys, popups or delays.

import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import CSL from '@emurgo/cardano-serialization-lib-nodejs';
import { encodeBlockActionDatum, decodeBlockActionDatumHex, decodeBlockActionDatumJson } from './datum.js';

const RECORD_LOVELACE = 1_000_000n; // 1 ADA per on-chain block record
const TX_TIMEOUT_MS = 10_000;

export class HydraClient extends EventEmitter {
  constructor({ wsUrl, httpUrl, privKey, address }) {
    super();
    this.wsUrl = wsUrl;
    this.httpUrl = httpUrl;
    this.privKey = privKey;
    this.address = address;
    this.addressBech32 = address.to_bech32('addr_test');

    this.ws = null;
    this.connected = false;
    this.stopped = false;
    this.reconnectDelay = 1000;

    this.fuel = null; // { txId, index, lovelace: BigInt }
    this.nextSeq = 0;
    this.queue = [];
    this.inFlight = null; // { txHash, cborHex, timer }

    this.stats = {
      headStatus: 'Disconnected',
      txSubmitted: 0,
      txValid: 0,
      txInvalid: 0,
      lastSnapshot: 0,
      utxoCount: 0,
      lastTxHash: null,
    };
  }

  connect() {
    if (this.stopped) return;
    const url = this.wsUrl + (this.wsUrl.includes('?') ? '' : '?history=no');
    this.ws = new WebSocket(url);

    this.ws.on('open', async () => {
      this.connected = true;
      this.reconnectDelay = 1000;
      console.log(`[hydra] connected to ${url}`);
      try {
        await this.syncFromSnapshot();
      } catch (err) {
        console.error('[hydra] initial snapshot sync failed:', err.message);
      }
      this.emitStats();
      this.processQueue();
    });

    this.ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      this.handleMessage(msg);
    });

    this.ws.on('close', () => {
      this.connected = false;
      this.stats.headStatus = 'Disconnected';
      this.emitStats();
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      if (!this.connected) console.log(`[hydra] connection error: ${err.message} (game keeps running locally)`);
    });
  }

  scheduleReconnect() {
    if (this.stopped) return;
    setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15_000);
  }

  handleMessage(msg) {
    switch (msg.tag) {
      case 'Greetings':
        this.stats.headStatus = msg.headStatus || 'Unknown';
        this.emitStats();
        break;
      case 'HeadIsOpen':
        this.stats.headStatus = 'Open';
        this.emitStats();
        break;
      case 'HeadIsClosed':
      case 'HeadIsFinalized':
        this.stats.headStatus = 'Closed';
        this.emitStats();
        break;
      case 'TxValid':
        this.stats.txValid += 1;
        this.resolveInFlight(msg, true);
        break;
      case 'TxInvalid':
        this.stats.txInvalid += 1;
        console.error('[hydra] TxInvalid:', JSON.stringify(msg.validationError || {}));
        this.resolveInFlight(msg, false);
        break;
      case 'SnapshotConfirmed':
        this.handleSnapshotConfirmed(msg);
        break;
      default:
        break;
    }
  }

  // ---- snapshot handling -------------------------------------------------

  handleSnapshotConfirmed(msg) {
    const snapshot = msg.snapshot || {};
    const number = snapshot.number ?? snapshot.snapshotNumber ?? this.stats.lastSnapshot + 1;
    this.stats.lastSnapshot = number;
    if (snapshot.utxo) this.stats.utxoCount = Object.keys(snapshot.utxo).length;

    const confirmed = snapshot.confirmed || snapshot.confirmedTransactions || [];
    for (const tx of confirmed) {
      for (const delta of this.decodeTxBlockActions(tx)) {
        this.stats.lastTxHash = delta.txHash;
        this.emit('blockDelta', { ...delta, confirmed: true, snapshot: number });
      }
    }
    this.emitStats();
  }

  decodeTxBlockActions(tx) {
    const cborHex = typeof tx === 'string' ? tx : tx?.cborHex || tx?.transaction?.cborHex;
    if (!cborHex) return [];
    const deltas = [];
    try {
      const parsed = CSL.Transaction.from_hex(cborHex);
      const txHash = CSL.FixedTransaction.from_hex(cborHex).transaction_hash().to_hex();
      const outputs = parsed.body().outputs();
      for (let i = 0; i < outputs.len(); i++) {
        const pd = outputs.get(i).plutus_data();
        if (!pd) continue;
        const delta = decodeBlockActionDatumHex(pd.to_hex());
        if (delta) deltas.push({ ...delta, txHash });
      }
    } catch (err) {
      console.error('[hydra] failed to decode confirmed tx:', err.message);
    }
    return deltas;
  }

  // Fetch full UTxO set of the head and decode every block-action datum.
  // Used for world reconstruction and to (re)locate the fuel UTxO.
  async fetchUtxo() {
    const res = await fetch(`${this.httpUrl}/snapshot/utxo`);
    if (!res.ok) throw new Error(`GET /snapshot/utxo -> HTTP ${res.status}`);
    return res.json();
  }

  extractBlockActions(utxoMap) {
    const actions = [];
    for (const [ref, out] of Object.entries(utxoMap)) {
      let decoded = null;
      if (out.inlineDatumRaw) decoded = decodeBlockActionDatumHex(out.inlineDatumRaw);
      if (!decoded && out.inlineDatum) decoded = decodeBlockActionDatumJson(out.inlineDatum);
      if (decoded) actions.push({ ...decoded, txHash: ref.split('#')[0], datumCbor: out.inlineDatumRaw || null });
    }
    actions.sort((a, b) => a.seq - b.seq);
    return actions;
  }

  async syncFromSnapshot() {
    const utxoMap = await this.fetchUtxo();
    this.stats.utxoCount = Object.keys(utxoMap).length;

    // fuel = biggest datum-less UTxO at our address
    let fuel = null;
    for (const [ref, out] of Object.entries(utxoMap)) {
      if (out.address !== this.addressBech32) continue;
      if (out.inlineDatum || out.inlineDatumRaw || out.datumhash) continue;
      const lovelace = BigInt(out.value?.lovelace ?? 0);
      if (!fuel || lovelace > fuel.lovelace) {
        const [txId, index] = ref.split('#');
        fuel = { txId, index: Number(index), lovelace };
      }
    }
    this.fuel = fuel;
    if (!fuel) console.error('[hydra] no fuel UTxO found at relay address — check docker/credentials/utxo.json');

    const actions = this.extractBlockActions(utxoMap);
    this.nextSeq = actions.length ? actions[actions.length - 1].seq + 1 : 0;
    this.emit('worldReplay', actions);
    console.log(`[hydra] snapshot sync: ${Object.keys(utxoMap).length} UTxOs, ${actions.length} block actions, fuel=${fuel ? fuel.lovelace : 'none'}`);
    return actions;
  }

  // ---- transaction submission --------------------------------------------

  submitBlockAction({ x, y, z, blockTypeId, action }) {
    this.queue.push({ x, y, z, blockTypeId, action });
    this.stats.txSubmitted += 1;
    this.emitStats();
    this.processQueue();
  }

  processQueue() {
    if (!this.connected || this.inFlight || this.queue.length === 0 || !this.fuel) return;
    const evt = this.queue.shift();
    const seq = this.nextSeq++;
    let built;
    try {
      built = this.buildTx(this.fuel, { ...evt, seq });
    } catch (err) {
      console.error('[hydra] tx build failed:', err.message);
      return this.processQueue();
    }

    const timer = setTimeout(() => {
      console.error('[hydra] tx timed out waiting for TxValid, resyncing fuel');
      this.inFlight = null;
      this.syncFromSnapshot().catch(() => {}).finally(() => this.processQueue());
    }, TX_TIMEOUT_MS);

    this.inFlight = { txHash: built.txHash, timer };

    // optimistic chaining: next tx spends this tx's change output
    this.fuel = { txId: built.txHash, index: 1, lovelace: built.changeLovelace };

    this.ws.send(JSON.stringify({
      tag: 'NewTx',
      transaction: { type: 'Tx ConwayEra', description: '', cborHex: built.cborHex },
    }));
  }

  resolveInFlight(msg, valid) {
    if (!this.inFlight) return;
    clearTimeout(this.inFlight.timer);
    this.inFlight = null;
    if (!valid) {
      // fuel pointer may be wrong — resync from snapshot, then continue
      this.syncFromSnapshot().catch(() => {}).finally(() => this.processQueue());
    } else {
      this.processQueue();
    }
    this.emitStats();
  }

  buildTx(fuel, blockAction) {
    const inputs = CSL.TransactionInputs.new();
    inputs.add(CSL.TransactionInput.new(CSL.TransactionHash.from_hex(fuel.txId), fuel.index));

    const changeLovelace = fuel.lovelace - RECORD_LOVELACE;
    if (changeLovelace < 0n) throw new Error('fuel exhausted');

    const outputs = CSL.TransactionOutputs.new();

    const record = CSL.TransactionOutput.new(
      this.address,
      CSL.Value.new(CSL.BigNum.from_str(RECORD_LOVELACE.toString()))
    );
    record.set_plutus_data(encodeBlockActionDatum(blockAction)); // inline datum
    outputs.add(record);

    const change = CSL.TransactionOutput.new(
      this.address,
      CSL.Value.new(CSL.BigNum.from_str(changeLovelace.toString()))
    );
    outputs.add(change);

    const body = CSL.TransactionBody.new_tx_body(inputs, outputs, CSL.BigNum.zero());
    const unsigned = CSL.Transaction.new(body, CSL.TransactionWitnessSet.new(), undefined);
    const fixed = CSL.FixedTransaction.from_bytes(unsigned.to_bytes());
    fixed.sign_and_add_vkey_signature(this.privKey);

    return {
      cborHex: fixed.to_hex(),
      txHash: fixed.transaction_hash().to_hex(),
      changeLovelace,
    };
  }

  emitStats() {
    // kept on this.stats so the relay's statsMessage() sees it too
    this.stats.fuelAda = this.fuel ? Number(this.fuel.lovelace / 1_000_000n) : null;
    this.emit('stats', { ...this.stats, connected: this.connected, queued: this.queue.length });
  }
}
