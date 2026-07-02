// WebSocket client for the relay server. Sends block events (fire-and-forget)
// and receives world state, live block updates and Hydra head stats.
//
// The game never blocks on this: if the relay or Hydra is down, everything
// keeps working locally and the socket silently reconnects.

export class HydraRelayClient {
  constructor({ onWorldState, onBlockUpdate, onStats, onConnectionChange, onTxConfirmed, onPlayers, onPlayerPos, onPlayerLeave }) {
    this.onWorldState = onWorldState;
    this.onBlockUpdate = onBlockUpdate;
    this.onStats = onStats;
    this.onConnectionChange = onConnectionChange;
    this.onTxConfirmed = onTxConfirmed;
    this.onPlayers = onPlayers;
    this.onPlayerPos = onPlayerPos;
    this.onPlayerLeave = onPlayerLeave;
    this.ws = null;
    this.connected = false;
    this.reconnectDelay = 1000;
    this.connect();
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    try {
      this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    } catch {
      return this.scheduleReconnect();
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectDelay = 1000;
      this.onConnectionChange?.(true);
    };

    this.ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === 'worldState') this.onWorldState?.(msg.blocks);
      else if (msg.type === 'blockUpdate') this.onBlockUpdate?.(msg);
      else if (msg.type === 'hydraStats') this.onStats?.(msg);
      else if (msg.type === 'txConfirmed') this.onTxConfirmed?.(msg);
      else if (msg.type === 'players') this.onPlayers?.(msg.list);
      else if (msg.type === 'playerPos') this.onPlayerPos?.(msg);
      else if (msg.type === 'playerLeave') this.onPlayerLeave?.(msg.id);
      else if (msg.type === 'hello') this.onHello?.(msg);
      else if (msg.type === 'host') this.onHost?.(msg.id);
      else if (msg.type === 'mobs') this.onMobs?.(msg.list);
      else if (msg.type === 'mobHit') this.onMobHit?.(msg);
      else if (msg.type === 'chat') this.onChat?.(msg);
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.onConnectionChange?.(false);
      this.scheduleReconnect();
    };

    this.ws.onerror = () => this.ws?.close();
  }

  scheduleReconnect() {
    setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10_000);
  }

  // action: 0 = place, 1 = break
  sendBlockEvent(x, y, z, blockTypeId, action) {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) return; // offline: local-only
    this.ws.send(JSON.stringify({ type: 'blockEvent', x, y, z, blockTypeId, action }));
  }

  sendPos(x, y, z, yaw) {
    this.send({ type: 'pos', x, y, z, yaw });
  }

  send(obj) {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(obj));
  }
}
