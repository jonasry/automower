export function createClientEventBus({ keepAliveMs = 25000, now = () => new Date().toISOString() } = {}) {
  const subscribers = new Set();
  const publishListeners = new Set();

  function writeEvent(res, eventName, payload) {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  function subscribe(res) {
    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });
    res.flushHeaders?.();
    res.write(': connected\n\n');

    const subscriber = { res, keepAliveTimer: null };

    function cleanup() {
      if (subscriber.keepAliveTimer) clearInterval(subscriber.keepAliveTimer);
      subscribers.delete(subscriber);
    }

    if (keepAliveMs > 0) {
      subscriber.keepAliveTimer = setInterval(() => {
        try {
          res.write(': keepalive\n\n');
        } catch {
          cleanup();
        }
      }, keepAliveMs);
      subscriber.keepAliveTimer.unref?.();
    }

    subscribers.add(subscriber);
    res.on?.('close', cleanup);
    return cleanup;
  }

  function publish(change) {
    const payload = {
      type: change.type ?? 'unknown',
      mowerId: change.mowerId ?? null,
      eventId: change.eventId ?? null,
      timestamp: change.timestamp ?? null,
      changed: Array.isArray(change.changed) ? change.changed : [],
      notifiedAt: now()
    };

    for (const listener of Array.from(publishListeners)) {
      listener(payload);
    }

    for (const subscriber of Array.from(subscribers)) {
      try {
        writeEvent(subscriber.res, 'mower-data', payload);
      } catch {
        if (subscriber.keepAliveTimer) clearInterval(subscriber.keepAliveTimer);
        subscribers.delete(subscriber);
      }
    }
  }

  function onPublish(listener) {
    publishListeners.add(listener);
    return () => publishListeners.delete(listener);
  }

  return {
    subscribe,
    publish,
    onPublish,
    get subscriberCount() {
      return subscribers.size;
    }
  };
}

export const clientEventBus = createClientEventBus();
