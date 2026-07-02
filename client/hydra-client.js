// WebSocket client for the relay server. Sends block events (fire-and-forget)
// and receives world state, live block updates and Hydra head stats.
//
// The game never blocks on this: if the relay or Hydra is down, everything
// keeps working locally and the socket silently reconnects.

export class HydraRelayClient {
  constructor({ onWorldState, onBlockUpdate, onStats, onConnectionChange }) {
    this.onWorldState = onWorldState;
    this.onBlockUpdate = onBlockUpdate;
    this.onStats = onStats;
    this.onConnectionChange = onConnectionChange;
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
}
