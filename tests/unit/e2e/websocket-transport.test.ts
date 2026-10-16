/**
 * Functional regression coverage for the CDP WebSocket transport
 * (M19 S4 review fix, P2).
 *
 * THE DEFECT THIS PINS
 * `tests/e2e/support/cdp.mjs` connected with the bare global `WebSocket`. That
 * global does not exist on Node 20.9 — and Node 20.9 is the minimum the project
 * supports: `package.json` pins Next.js 16.3.1, whose own `engines` field
 * requires `node >= 20.9.0`. The WHATWG WebSocket global only arrived behind
 * `--experimental-websocket` in Node 20.10.0 (nodejs/node#49830) and became
 * available by default in Node 22.4.0, so on the supported floor the whole E2E
 * layer died with `ReferenceError: WebSocket is not defined`.
 *
 * WHAT THIS COVERS
 * 1. With `globalThis.WebSocket` removed — the exact Node 20.9 situation — the
 *    fallback transport completes a real RFC 6455 handshake and round trip
 *    against an independent echo server: masked client frames, a fragmented
 *    server message, ping/pong and close.
 * 2. When the runtime provides the global (Node >= 22.4) the native transport
 *    completes the very same round trip, so the two implementations cannot
 *    silently drift apart.
 * The byte-level codec and the source-level guards live in
 * `./websocket-compat-guards.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertWebsocketTransport,
  hasNativeWebSocket,
  openWebSocket,
} from '../../e2e/support/websocket.mjs';

import { startWebSocketEchoServer, type WebSocketEchoServer } from '../helpers/websocket-echo-server';

/** The subset of the WHATWG WebSocket API `cdp.mjs` drives. */
interface SocketLike {
  addEventListener(
    type: string,
    handler: (event: { data?: string }) => void,
    options?: { once?: boolean },
  ): void;
  send(data: string): void;
  close(): void;
}

function openCollecting(url: string): { socket: SocketLike; messages: string[]; errors: unknown[] } {
  const socket: SocketLike = openWebSocket(url);
  const messages: string[] = [];
  const errors: unknown[] = [];
  socket.addEventListener('message', (event) => messages.push(String(event.data)));
  socket.addEventListener('error', (event) => errors.push(event));
  return { socket, messages, errors };
}

const servers: WebSocketEchoServer[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function start(): Promise<WebSocketEchoServer> {
  const server = await startWebSocketEchoServer();
  servers.push(server);
  return server;
}

async function expectFullRoundTrip(server: WebSocketEchoServer): Promise<void> {
  const { socket, messages, errors } = openCollecting(server.url);

  // The server wrote ONE packet: fragmented `frag-` + `mented`, then a ping.
  await vi.waitFor(
    () => {
      expect(messages).toContain('frag-mented');
    },
    { timeout: 5_000 },
  );
  // RFC 6455 requires the client to answer a ping with a pong.
  await vi.waitFor(
    () => {
      expect(server.pongCount()).toBe(1);
    },
    { timeout: 5_000 },
  );

  // A CDP-shaped request must survive the client→server masking round trip.
  const request = JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression: '1 + 1' },
  });
  socket.send(request);
  await vi.waitFor(
    () => {
      expect(server.received).toContain(request);
    },
    { timeout: 5_000 },
  );
  await vi.waitFor(
    () => {
      expect(messages).toContain(request);
    },
    { timeout: 5_000 },
  );

  expect(errors).toEqual([]);
  expect(server.connectionCount()).toBe(1);
  socket.close();
}

describe('CDP WebSocket transport selection', () => {
  it('uses the platform global when the runtime provides one (Node >= 22.4)', () => {
    const hasGlobal = typeof globalThis.WebSocket === 'function';
    expect(hasNativeWebSocket()).toBe(hasGlobal);
    expect(assertWebsocketTransport().kind).toBe(hasGlobal ? 'native' : 'fallback');
  });

  it('passes the explicit runtime check with the global removed (Node 20.9)', () => {
    vi.stubGlobal('WebSocket', undefined);
    expect(hasNativeWebSocket()).toBe(false);
    expect(() => assertWebsocketTransport()).not.toThrow();
    expect(assertWebsocketTransport().kind).toBe('fallback');
  });

  it('fails loudly, naming the API, when a runtime offers an unusable WebSocket', () => {
    class Unusable {}
    vi.stubGlobal('WebSocket', Unusable);
    expect(() => assertWebsocketTransport()).toThrow(
      /missing WebSocket\.addEventListener\(\), WebSocket\.send\(\), WebSocket\.close\(\)/,
    );
  });
});

describe('CDP WebSocket round trip with no global WebSocket (Node 20.9)', () => {
  it('completes a real handshake and round trip on the fallback transport', async () => {
    const server = await start();
    vi.stubGlobal('WebSocket', undefined);
    await expectFullRoundTrip(server);
  });
});

describe('CDP WebSocket round trip through the platform global', () => {
  it.skipIf(!hasNativeWebSocket())(
    'completes the same round trip on the native transport (Node >= 22.4)',
    async () => {
      const server = await start();
      await expectFullRoundTrip(server);
    },
  );
});
