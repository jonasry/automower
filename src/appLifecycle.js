async function startRuntime({
  assertDatabaseReady,
  startHttpServer,
  loadMowerState,
  startWebSocket,
  token,
  apiKey,
  apiSecret
}) {
  await assertDatabaseReady();
  await loadMowerState(token, apiKey, apiSecret);
  await startWebSocket(apiKey, apiSecret);
  return startHttpServer();
}

function withTimeout(promise, timeoutMs) {
  let timeout;
  const expired = new Promise((resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Timed out during shutdown after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timeout));
}

function createShutdown({
  stopWebSocket,
  closeClientEvents,
  closeHttpServer,
  drainIncomingEvents,
  closeDb,
  timeoutMs = 10000
}) {
  let shutdownPromise = null;

  return function shutdown() {
    if (!shutdownPromise) {
      const work = (async () => {
        await stopWebSocket();
        await closeClientEvents();
        await closeHttpServer();
        await drainIncomingEvents();
        await closeDb();
      })();
      shutdownPromise = withTimeout(work, timeoutMs);
    }
    return shutdownPromise;
  };
}

export { createShutdown, startRuntime };
