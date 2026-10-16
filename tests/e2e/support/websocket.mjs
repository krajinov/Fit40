/**
 * WebSocket transport selection for the CDP E2E harness (M19 S4 review fix, P2).
 *
 * WHY THIS FILE EXISTS
 * `npm run test:e2e` drives the installed Chrome over the Chrome DevTools
 * Protocol. `cdp.mjs` used to call `new WebSocket(url)` and therefore depended on
 * Node's *global* WebSocket — which is not part of the runtime this project
 * supports. `package.json` pins Next.js 16.3.1, whose `engines` field requires
 * `node >= 20.9.0`; the WHATWG WebSocket global only arrived behind
 * `--experimental-websocket` in Node 20.10.0/21.0.0 (nodejs/node#49830) and is
 * on by default only from Node 22.0.0 (marked stable in 22.4.0). On Node 20.9.0
 * — the project's minimum supported runtime — `new WebSocket(...)` throws
 * `ReferenceError: WebSocket is not defined`, so the whole E2E layer was dead on
 * a version the project officially supports.
 *
 * WHAT THIS DOES
 * `openWebSocket()` prefers the platform's global WebSocket when it exists
 * (Node >= 22, browsers, Deno, Bun) and otherwise uses the dependency-free
 * RFC 6455 client in `./minimal-websocket.mjs`. `AGENTS.md` forbids adding a
 * dependency without approval, so the fallback is written here rather than
 * pulling in `ws`.
 *
 * Every caller that needs a socket MUST go through `openWebSocket()`; the
 * regression test in `tests/unit/e2e/websocket-transport.test.ts` fails if
 * `cdp.mjs` ever reaches for the global directly again.
 */
import { MinimalWebSocket } from './minimal-websocket.mjs';

/** The subset of the WHATWG WebSocket API that `cdp.mjs` uses. */
const REQUIRED_API = ['addEventListener', 'send', 'close'];

const NATIVE_TRANSPORT = {
  kind: 'native',
  label: 'global WebSocket',
  prototype: () => globalThis.WebSocket.prototype,
  create: (url) => new globalThis.WebSocket(url),
};

const FALLBACK_TRANSPORT = {
  kind: 'fallback',
  label: 'built-in fallback WebSocket (dependency-free RFC 6455 client)',
  prototype: () => MinimalWebSocket.prototype,
  create: (url) => new MinimalWebSocket(url),
};

/** True when the runtime exposes the WHATWG WebSocket global (Node >= 22). */
export function hasNativeWebSocket() {
  return typeof globalThis.WebSocket === 'function';
}

/**
 * Explicit runtime compatibility check (M19 S4 review fix, P2).
 *
 * A missing global is *expected* on supported Node versions — that is exactly
 * what the built-in fallback is for — so this never fails merely because
 * `globalThis.WebSocket` is undefined. It instead verifies that whichever
 * transport the runtime selects actually exposes the API `cdp.mjs` drives, so a
 * future runtime change fails with one labelled line naming the missing method
 * rather than with `socket.addEventListener is not a function` mid-test.
 */
export function resolveWebsocketTransport() {
  const transport = hasNativeWebSocket() ? NATIVE_TRANSPORT : FALLBACK_TRANSPORT;
  const prototype = transport.prototype();
  const missing = REQUIRED_API.filter((method) => typeof prototype?.[method] !== 'function');
  return { transport, missing };
}

/** Throws a labelled error when the selected transport is unusable. */
export function assertWebsocketTransport() {
  const { transport, missing } = resolveWebsocketTransport();
  if (missing.length > 0) {
    throw new Error(
      `Fit40 E2E: the ${transport.label} is missing WebSocket.${missing.join('(), WebSocket.')}()`,
    );
  }
  return transport;
}

/**
 * Opens a WebSocket with whichever implementation this runtime provides. This
 * is the single compatibility boundary for the CDP client: never construct the
 * global WebSocket directly, or the harness stops working on Node 20.9.
 */
export function openWebSocket(url) {
  return assertWebsocketTransport().create(url);
}
