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
  const server = startHttpServer();
  await loadMowerState(token, apiKey, apiSecret);
  await startWebSocket(apiKey, apiSecret);
  return server;
}

function withTimeout(promise, timeoutMs) {
  let timeout;
  const expired = new Promise((resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Timed out draining in-flight work after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timeout));
}

function createShutdown({
  stopWebSocket,
  closeHttpServer,
  drainIncomingEvents,
  closeDb,
  timeoutMs = 10000
}) {
  let shutdownPromise = null;

  return function shutdown() {
    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        await stopWebSocket();
        await closeHttpServer();
        await withTimeout(Promise.resolve(drainIncomingEvents()), timeoutMs);
        await closeDb();
      })();
    }
    return shutdownPromise;
  };
}

export { createShutdown, startRuntime };
