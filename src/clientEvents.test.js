import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createClientEventBus } from './clientEvents.js';

class FakeResponse extends EventEmitter {
  constructor() {
    super();
    this.headers = null;
    this.statusCode = null;
    this.chunks = [];
    this.flushed = false;
  }

  set(headers) {
    this.headers = headers;
  }

  status(code) {
    this.statusCode = code;
    return this;
  }

  flushHeaders() {
    this.flushed = true;
  }

  write(chunk) {
    this.chunks.push(chunk);
  }
}

test('streams published mower data changes to subscribers', () => {
  const bus = createClientEventBus({ keepAliveMs: 0, now: () => '2026-05-23T10:00:00.000Z' });
  const res = new FakeResponse();

  bus.subscribe(res);
  bus.publish({
    type: 'position-event-v2',
    mowerId: 'mower-1',
    eventId: 42,
    timestamp: '2026-05-23T09:59:59.000Z',
    changed: ['position']
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'text/event-stream');
  assert.equal(res.flushed, true);
  assert.equal(bus.subscriberCount, 1);
  assert.match(res.chunks.join(''), /event: mower-data/);
  assert.match(res.chunks.join(''), /"mowerId":"mower-1"/);
  assert.match(res.chunks.join(''), /"changed":\["position"\]/);
  assert.match(res.chunks.join(''), /"notifiedAt":"2026-05-23T10:00:00.000Z"/);
});

test('removes subscribers when the response closes', () => {
  const bus = createClientEventBus({ keepAliveMs: 0 });
  const res = new FakeResponse();

  bus.subscribe(res);
  res.emit('close');

  assert.equal(bus.subscriberCount, 0);
});

test('normalizes unknown changes to an empty changed list', () => {
  const bus = createClientEventBus({ keepAliveMs: 0, now: () => '2026-05-23T10:00:00.000Z' });
  const res = new FakeResponse();

  bus.subscribe(res);
  bus.publish({ type: 'mower-event-v2', mowerId: 'mower-1' });

  assert.match(res.chunks.join(''), /"changed":\[\]/);
});
