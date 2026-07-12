const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { Server } = require('socket.io');
const { io: Client } = require('socket.io-client');

// Import the relay wiring. server.js starts listening on import, so we
// require it and connect to its port via an ephemeral server instance here.
// To keep the test self-contained we re-create the same relay wiring by
// requiring a factory. server.js must export `attachRelay(io)` (added in Step 4).
const { attachRelay } = require('../server');

let httpServer, ioServer, port;

before(async () => {
  httpServer = http.createServer();
  ioServer = new Server(httpServer, { cors: { origin: '*' } });
  attachRelay(ioServer);
  await new Promise((res) => httpServer.listen(0, res));
  port = httpServer.address().port;
});

after(() => {
  ioServer.close();
  httpServer.close();
});

function connect() {
  return Client(`http://localhost:${port}`, { transports: ['websocket'] });
}

test('relays intent from reader to viewer in the same room', async () => {
  const viewer = connect();
  const reader = connect();
  await new Promise((res) => viewer.on('connect', res));
  await new Promise((res) => reader.on('connect', res));

  await new Promise((res) => viewer.emit('create-room', 'ROOM01', res));
  await new Promise((res) => reader.emit('join-room', 'ROOM01', res));

  const got = new Promise((res) => viewer.on('intent', res));
  reader.emit('intent', { action: 'next' });
  const payload = await got;
  assert.deepStrictEqual(payload, { action: 'next' });

  viewer.close();
  reader.close();
});

test('relays hud from viewer to reader in the same room', async () => {
  const viewer = connect();
  const reader = connect();
  await new Promise((res) => viewer.on('connect', res));
  await new Promise((res) => reader.on('connect', res));

  await new Promise((res) => viewer.emit('create-room', 'ROOM02', res));
  await new Promise((res) => reader.emit('join-room', 'ROOM02', res));

  const got = new Promise((res) => reader.on('hud', res));
  viewer.emit('hud', { index: 2, total: 10, notes: 'hello', startedAt: 111 });
  const payload = await got;
  assert.deepStrictEqual(payload, { index: 2, total: 10, notes: 'hello', startedAt: 111 });

  viewer.close();
  reader.close();
});
