/**
 * Minimal Chrome DevTools Protocol client built on Node built-ins only
 * (`fetch`, the global `WebSocket`). No third-party dependency, because
 * `AGENTS.md` forbids adding one without explicit approval and this repository
 * has no E2E runner installed (see `tests/e2e/support/browser.mjs`).
 *
 * Only the handful of commands the mobile-header regression test needs:
 * `Runtime.evaluate`, `Input.dispatchKeyEvent` (real Tab), `Emulation` viewport
 * overrides and `Page.navigate`.
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function connect(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error(`cannot open ${webSocketUrl}`)), {
      once: true,
    });
  });

  let nextId = 0;
  const pending = new Map();
  const eventWaiters = new Map();

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      if (!entry) {
        return;
      }
      pending.delete(message.id);
      if (message.error) {
        entry.reject(new Error(`${entry.method}: ${message.error.message}`));
      } else {
        entry.resolve(message.result);
      }
      return;
    }
    const waiters = eventWaiters.get(message.method);
    if (waiters) {
      eventWaiters.delete(message.method);
      for (const waiter of waiters) {
        waiter(message.params);
      }
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject, method });
      socket.send(JSON.stringify({ id, method, params }));
    });

  const waitFor = (method) =>
    new Promise((resolve) => {
      const waiters = eventWaiters.get(method) ?? [];
      waiters.push(resolve);
      eventWaiters.set(method, waiters);
    });

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`page evaluation failed: ${result.exceptionDetails.text}`);
    }
    return result.result.value;
  };

  /** Sends one real Tab key press, exactly as a keyboard user would. */
  const pressTab = async () => {
    for (const type of ['rawKeyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {
        type,
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9,
        nativeVirtualKeyCode: 9,
      });
    }
    await sleep(25);
  };

  const setViewport = (width, height) =>
    send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });

  return { send, waitFor, evaluate, pressTab, setViewport, close: () => socket.close() };
}