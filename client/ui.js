// HUD: hotbar (1-9 / scroll wheel), crosshair, debug overlay and the
// Hydra debug overlay (toggled with H).

import { BLOCKS } from './world.js';

export class UI {
  constructor() {
    this.selected = 0;
    this.hydraVisible = false;
    this.txSubmittedLocal = 0;
    this.onSelect = null; // hook, set by main.js (updates held block)
    this.buildHotbar();
    this.bindInput();
    this.hydraEl = document.getElementById('hydra-overlay');
    this.debugEl = document.getElementById('debug-overlay');
    this.feedEl = document.getElementById('chain-feed');
    this.minimapBox = document.getElementById('minimap-box');
  }

  buildHotbar() {
    const bar = document.getElementById('hotbar');
    this.slots = BLOCKS.map((block, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      const swatch = document.createElement('div');
      swatch.className = 'swatch';
      swatch.style.background = '#' + block.color.toString(16).padStart(6, '0');
      if (block.transparent) swatch.style.opacity = String(0.45 + (block.opacity ?? 1) * 0.5);
      const label = document.createElement('span');
      label.textContent = String(i + 1);
      const name = document.createElement('em');
      name.textContent = block.name;
      slot.append(swatch, label, name);
      slot.addEventListener('click', () => this.select(i));
      bar.appendChild(slot);
      return slot;
    });
    this.select(0);
  }

  select(i) {
    this.selected = ((i % BLOCKS.length) + BLOCKS.length) % BLOCKS.length;
    this.slots.forEach((s, j) => s.classList.toggle('active', j === this.selected));
    this.onSelect?.(this.selected);
  }

  bindInput() {
    document.addEventListener('keydown', (e) => {
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= 9) this.select(n - 1);
      }
      if (e.code === 'KeyH') {
        this.hydraVisible = !this.hydraVisible;
        this.hydraEl.classList.toggle('hidden', !this.hydraVisible);
      }
      if (e.code === 'KeyM') this.minimapBox.classList.toggle('hidden');
    });
    document.addEventListener('wheel', (e) => {
      this.select(this.selected + (e.deltaY > 0 ? 1 : -1));
    });
  }

  get selectedBlockId() {
    return this.selected;
  }

  countTxSubmitted() {
    this.txSubmittedLocal += 1;
  }

  updateHydra(stats) {
    if (!stats) return;
    this._lastStats = stats;
    const s = stats;
    const conn = s.connected ? 'connected' : 'DISCONNECTED (playing offline)';
    this.hydraEl.innerHTML = [
      '<b>HYDRA L2 [H]</b>',
      `head status: ${s.headStatus}`,
      `relay link: ${conn}`,
      `tx submitted: ${s.txSubmitted}`,
      `tx valid / invalid: ${s.txValid} / ${s.txInvalid}`,
      `last snapshot: #${s.lastSnapshot}`,
      `UTxOs in head: ${s.utxoCount}`,
      `queued: ${s.queued ?? 0}`,
      `last tx: ${s.lastTxHash ? s.lastTxHash.slice(0, 12) + '…' : '-'}`,
      `fuel: ${s.fuelAda != null ? s.fuelAda.toLocaleString() + ' ₳' : '-'}`,
      `<i>full log: <u>/chain</u></i>`,
    ].join('<br>');
  }

  // on-chain activity feed (bottom right): confirmed Hydra transactions
  pushFeed({ txHash, snapshot, x, y, z, blockTypeId, action }) {
    const el = document.createElement('div');
    el.className = 'feed-item';
    const verb = action === 1 ? 'break' : 'place';
    el.innerHTML = `⛓ <b>${verb}</b> ${BLOCKS[blockTypeId]?.name.toLowerCase() ?? '?'} (${x},${y},${z}) · tx <span>${(txHash || '').slice(0, 10)}…</span> · snap #${snapshot}`;
    this.feedEl.prepend(el);
    while (this.feedEl.children.length > 6) this.feedEl.lastChild.remove();
    setTimeout(() => { el.classList.add('fade'); }, 14000);
    setTimeout(() => { el.remove(); }, 15000);
  }

  updateDebug({ fps, position, targetBlock, online, mode, others }) {
    this.debugEl.innerHTML = [
      `${fps.toFixed(0)} fps · ${mode}`,
      `xyz: ${position.x.toFixed(1)} / ${position.y.toFixed(1)} / ${position.z.toFixed(1)}`,
      `looking at: ${targetBlock ? `${BLOCKS[targetBlock.blockId].name} (${targetBlock.x},${targetBlock.y},${targetBlock.z})` : '-'}`,
      `server: ${online ? 'online' : 'offline'} · players nearby: ${others}`,
    ].join('<br>');
  }
}
