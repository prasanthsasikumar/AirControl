class MiniSocketIO {
  constructor(serverUrl) {
    this._url = serverUrl.replace(/\/+$/, '');
    this.ws = null;
    this.sid = null;
    this.connected = false;
    this._ackId = 0;
    this._acks = {};
    this._handlers = {};
  }

  connect() {
    const wsUrl =
      this._url.replace(/^http/, 'ws') +
      '/socket.io/?EIO=4&transport=websocket';
    console.log('[bg] connecting WS:', wsUrl);

    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = () => console.log('[bg] WS open');
    this.ws.onmessage = (e) => this._onRaw(e.data);
    this.ws.onclose = () => {
      console.log('[bg] WS closed');
      this.connected = false;
      this._fire('disconnect');
    };
    this.ws.onerror = (e) => {
      console.error('[bg] WS error', e);
      this._fire('error', e);
    };
  }

  // ── Send a Socket.IO event ──────────────────────────────────────────────
  emit(event, ...args) {
    const last = args[args.length - 1];
    const hasAck = typeof last === 'function';
    const ack = hasAck ? args.pop() : null;

    let packet;
    if (ack) {
      const id = this._ackId++;
      this._acks[id] = ack;
      packet = `42${id}${JSON.stringify([event, ...args])}`;
    } else {
      packet = `42${JSON.stringify([event, ...args])}`;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(packet);
    }
  }

  on(event, handler) {
    (this._handlers[event] ||= []).push(handler);
  }

  disconnect() {
    if (this.ws) this.ws.close();
  }

  // ── Internal: parse incoming frames ─────────────────────────────────────
  _onRaw(raw) {
    const eioType = parseInt(raw[0], 10);
    const rest = raw.slice(1);

    switch (eioType) {
      case 0: { // Engine.IO OPEN
        const info = JSON.parse(rest);
        this.sid = info.sid;
        console.log('[bg] EIO open, sid:', this.sid);
        // Send Socket.IO CONNECT to default namespace
        this.ws.send('40');
        break;
      }
      case 2: // Engine.IO PING
        this.ws.send('3'); // PONG
        break;
      case 4: // Engine.IO MESSAGE → Socket.IO packet
        this._parseSIO(rest);
        break;
    }
  }

  _parseSIO(raw) {
    const sioType = parseInt(raw[0], 10);
    const rest = raw.slice(1);

    switch (sioType) {
      case 0: // SIO CONNECT
        this.connected = true;
        console.log('[bg] SIO connected');
        this._fire('connect');
        break;
      case 2: { // SIO EVENT
        // Could have an ack id prefix before the JSON array
        const m = rest.match(/^(\d*?)(\[.*)$/s);
        if (!m) break;
        const data = JSON.parse(m[2]);
        const [event, ...args] = data;
        this._fire(event, ...args);
        break;
      }
      case 3: { // SIO ACK
        const m = rest.match(/^(\d+)(.*)$/s);
        if (m) {
          const id = parseInt(m[1], 10);
          const payload = JSON.parse(m[2]);
          if (this._acks[id]) {
            this._acks[id](...(Array.isArray(payload) ? payload : [payload]));
            delete this._acks[id];
          }
        }
        break;
      }
    }
  }

  _fire(event, ...args) {
    (this._handlers[event] || []).forEach((h) => h(...args));
  }
}

if (typeof window !== 'undefined') window.MiniSocketIO = MiniSocketIO;
