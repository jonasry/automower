import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createConnectionLifecycle, waitForWebSocketClose } from './amconnect.js';

test('intentional stop suppresses reconnect without disabling later starts', () => {
  const lifecycle = createConnectionLifecycle();
  const first = lifecycle.start();
  assert.equal(lifecycle.shouldReconnect(first), true);

  lifecycle.stop();
  assert.equal(lifecycle.shouldReconnect(first), false);

  const second = lifecycle.start();
  assert.equal(lifecycle.isCurrent(first), false);
  assert.equal(lifecycle.isCurrent(second), true);
  assert.equal(lifecycle.shouldReconnect(second), true);
});

test('waitForWebSocketClose resolves only after an active socket closes', async () => {
  class FakeSocket extends EventEmitter {
    static OPEN = 1;

    constructor() {
      super();
      this.readyState = FakeSocket.OPEN;
      this.closeCalled = false;
    }

    close() {
      this.closeCalled = true;
    }
  }

  const socket = new FakeSocket();
  let resolved = false;
  const closing = waitForWebSocketClose(socket).then(() => { resolved = true; });
  await Promise.resolve();
  assert.equal(socket.closeCalled, true);
  assert.equal(resolved, false);

  socket.readyState = 3;
  socket.emit('close');
  await closing;
  assert.equal(resolved, true);
});
