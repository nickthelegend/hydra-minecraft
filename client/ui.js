// HUD: hotbar (1-9,0 / scroll wheel), crosshair, hearts, breath, chat,
// debug overlay and the Hydra debug overlay (toggled with H).

import { BLOCKS } from './world.js';

const isTyping = (e) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

export class UI {
  constructor() {
    this.selected = 0;
    this.hydraVisible = false;
    this.txSubmittedLocal = 0;
    this.mode = 'creative';
    this.counts = BLOCKS.map(() => 0); // survival inventory
    this.onSelect = null; // hooks, set by main.js
    this.onChatSend = null;
    this.onModeToggle = null;
    this.buildHotbar();
    this.bindInput();
    this.hydraEl = document.getElementById('hydra-overlay');
    this.debugEl = document.getElementById('debug-overlay');
    this.feedEl = document.getElementById('chain-feed');
    this.minimapBox = document.getElementById('minimap-box');
    this.heartsEl = document.getElementById('hearts');
    this.breathEl = document.getElementById('breath');
    this.chatLogEl = document.getElementById('chat-log');
    this.chatInputEl = document.getElementById('chat-input');
    this.deathEl = document.getElementById('death-overlay');
    this.buildHearts();
  }

  // ---- hotbar ---------------------------------------------------------------

  buildHotbar() {
    const bar = document.getElementById('hotbar');
    this.slots = BLOCKS.map((block, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      const swatch = document.createElement('div');
      swatch.className = 'swatch';
      swatch.style.background = block.tnt
        ? 'repeating-linear-gradient(0deg, #d94534 0 6px, #f2e7d5 6px 12px)'
        : '#' + block.color.toString(16).padStart(6, '0');
      if (block.transparent) swatch.style.opacity = String(0.45 + (block.opacity ?? 1) * 0.5);
      const label = document.createElement('span');
      label.textContent = i < 10 ? String((i + 1) % 10) : ''; // keys 1-9,0; ores via scroll/pick
      const name = document.createElement('em');
      name.textContent = block.name;
      const count = document.createElement('i');
      count.className = 'count hidden';
      slot.append(swatch, label, name, count);
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

  // ---- survival inventory -----------------------------------------------------

  setMode(mode) {
    this.mode = mode;
    this.heartsEl.classList.toggle('hidden', mode !== 'survival');
    this.slots.forEach((s) => s.querySelector('.count').classList.toggle('hidden', mode !== 'survival'));
    this.refreshCounts();
  }

  refreshCounts() {
    if (this.mode !== 'survival') return;
    this.slots.forEach((s, i) => {
      const el = s.querySelector('.count');
      el.textContent = this.counts[i];
      s.classList.toggle('empty', this.counts[i] === 0);
    });
  }

  addItem(blockId, n = 1) {
    this.counts[blockId] += n;
    this.refreshCounts();
  }

  // returns true if the player may place the selected block (and consumes it)
  consumeSelected() {
    if (this.mode === 'creative') return true;
    if (this.counts[this.selected] <= 0) return false;
    this.counts[this.selected] -= 1;
    this.refreshCounts();
    return true;
  }

  // ---- health / breath -----------------------------------------------------------

  buildHearts() {
    this.heartEls = [];
    for (let i = 0; i < 10; i++) {
      const h = document.createElement('span');
      h.textContent = '♥';
      this.heartsEl.appendChild(h);
      this.heartEls.push(h);
    }
    this.bubbleEls = [];
    for (let i = 0; i < 10; i++) {
      const b = document.createElement('span');
      b.textContent = '●';
      this.breathEl.appendChild(b);
      this.bubbleEls.push(b);
    }
  }

  updateHealth(hp) {
    this.heartEls.forEach((h, i) => {
      const v = hp - i * 2;
      h.className = v >= 2 ? 'full' : v >= 1 ? 'half' : 'empty';
    });
  }

  updateBreath(breath, maxBreath, show) {
    this.breathEl.classList.toggle('hidden', !show);
    if (!show) return;
    const frac = (breath / maxBreath) * 10;
    this.bubbleEls.forEach((b, i) => b.classList.toggle('empty', i >= frac));
  }

  showDeath(show) {
    this.deathEl.classList.toggle('hidden', !show);
  }

  // ---- chat ------------------------------------------------------------------------

  get chatOpen() {
    return !this.chatInputEl.classList.contains('hidden');
  }

  openChat() {
    this.chatInputEl.classList.remove('hidden');
    this.chatInputEl.value = '';
    setTimeout(() => this.chatInputEl.focus(), 0);
  }

  closeChat() {
    this.chatInputEl.classList.add('hidden');
    this.chatInputEl.blur();
  }

  addChat(name, text, self = false) {
    const el = document.createElement('div');
    el.className = 'chat-item';
    el.innerHTML = `<b${self ? ' class="self"' : ''}>${name}</b> ${text.replace(/</g, '&lt;')}`;
    this.chatLogEl.appendChild(el);
    while (this.chatLogEl.children.length > 8) this.chatLogEl.firstChild.remove();
    setTimeout(() => el.classList.add('fade'), 11000);
    setTimeout(() => el.remove(), 12000);
  }

  // ---- input -----------------------------------------------------------------------

  bindInput() {
    document.addEventListener('keydown', (e) => {
      if (isTyping(e)) {
        if (e.code === 'Enter') {
          const text = this.chatInputEl.value.trim();
          this.closeChat();
          if (text) this.onChatSend?.(text);
        } else if (e.code === 'Escape') {
          this.closeChat();
        }
        return;
      }
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= 9) this.select(n - 1);
        if (n === 0 && BLOCKS.length > 9) this.select(9);
      }
      if (e.code === 'KeyH') {
        this.hydraVisible = !this.hydraVisible;
        this.hydraEl.classList.toggle('hidden', !this.hydraVisible);
      }
      if (e.code === 'KeyM') this.minimapBox.classList.toggle('hidden');
      if (e.code === 'KeyG') this.onModeToggle?.();
      if (e.code === 'KeyT') {
        e.preventDefault();
        document.exitPointerLock?.();
        this.openChat();
      }
    });
    document.addEventListener('wheel', (e) => {
      if (!this.chatOpen) this.select(this.selected + (e.deltaY > 0 ? 1 : -1));
    });
  }

  get selectedBlockId() {
    return this.selected;
  }

  countTxSubmitted() {
    this.txSubmittedLocal += 1;
  }

  // ---- overlays ------------------------------------------------------------------

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

  updateDebug({ fps, position, targetBlock, online, mode, others, mobs }) {
    this.debugEl.innerHTML = [
      `${fps.toFixed(0)} fps · ${mode} · ${this.mode} [G]`,
      `xyz: ${position.x.toFixed(1)} / ${position.y.toFixed(1)} / ${position.z.toFixed(1)}`,
      `looking at: ${targetBlock ? `${BLOCKS[targetBlock.blockId].name} (${targetBlock.x},${targetBlock.y},${targetBlock.z})` : '-'}`,
      `server: ${online ? 'online' : 'offline'} · players: ${others} · mobs: ${mobs}`,
    ].join('<br>');
  }
}
