/**
 * A hand-rolled RFC 6455 echo server for the E2E WebSocket transport regression
 * test (M19 S4 review fix, P2).
 *
 * It is deliberately an INDEPENDENT implementation from the client under test
 * (`tests/e2e/support/websocket-frames.mjs`): it writes UNMASKED server frames
 * and decodes MASKED client frames, so a client that stopped masking payloads,
 * mishandled fragmentation, never answered a ping or computed the handshake
 * digest wrongly fails here instead of passing against its own bug.
 *
 * Scripted behaviour, covering every branch the CDP client needs:
 *  - on connect it writes ONE packet holding a fragmented text message
 *    (`frag-` + `mented`) followed by a ping, so a client that only inspects
 *    the handshake packet's remainder cannot miss them;
 *  - every text frame received is recorded and echoed back as one frame;
 *  - pong frames are counted.
 */
import { createHash } from 'node:crypto';
import http from 'node:http';
import type { Duplex } from 'node:stream';

const HANDSHAKE_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OPCODE_CONTINUATION = 0x0;
const OPCODE_TEXT = 0x1;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

interface ClientFrame {
  final: boolean;
  opcode: number;
  payload: Buffer;
}

export interface WebSocketEchoServer {
  /** The `ws://` URL a client should connect to. */
  readonly url: string;
  /** Text messages received from clients, in arrival order. */
  readonly received: string[];
  /** Connections accepted so far. */
  connectionCount(): number;
  /** Pong frames received so far. */
  pongCount(): number;
  close(): Promise<void>;
}

/** Encodes an unmasked server→client frame (servers never mask). */
function serverFrame(opcode: number, payload: Buffer, final: boolean): Buffer {
  const header = [opcode | (final ? 0x80 : 0x00)];
  if (payload.length < 126) {
    header.push(payload.length);
  } else if (payload.length < 0x10000) {
    header.push(126, (payload.length >> 8) & 0xff, payload.length & 0xff);
  } else {
    const extended = Buffer.alloc(8);
    extended.writeBigUInt64BE(BigInt(payload.length));
    header.push(127, ...extended);
  }
  return Buffer.concat([Buffer.from(header), payload]);
}

/** Sends the scripted handshake-packet bytes: one fragmented text plus a ping. */
function initialServerBytes(): Buffer {
  return Buffer.concat([
    serverFrame(OPCODE_TEXT, Buffer.from('frag-', 'utf8'), false),
    serverFrame(OPCODE_CONTINUATION, Buffer.from('mented', 'utf8'), true),
    serverFrame(OPCODE_PING, Buffer.from('ping', 'utf8'), true),
  ]);
}

/** Reads one masked client frame, or null while more bytes are needed. */
function readClientFrame(state: { buffer: Buffer }): ClientFrame | null {
  const { buffer } = state;
  if (buffer.length < 2) {
    return null;
  }
  const first = buffer.readUInt8(0);
  const second = buffer.readUInt8(1);
  const final = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) {
      return null;
    }
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) {
      return null;
    }
    length = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }
  let key: Buffer | null = null;
  if (masked) {
    if (buffer.length < offset + 4) {
      return null;
    }
    key = buffer.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + length) {
    return null;
  }
  const raw = buffer.subarray(offset, offset + length);
  const payload = Buffer.allocUnsafe(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    payload[i] = key === null ? raw.readUInt8(i) : raw.readUInt8(i) ^ key.readUInt8(i % 4);
  }
  state.buffer = buffer.subarray(offset + length);
  return { final, opcode, payload };
}

/** Boots the echo server on an ephemeral localhost port. */
export async function startWebSocketEchoServer(): Promise<WebSocketEchoServer> {
  const received: string[] = [];
  const sockets = new Set<Duplex>();
  let connectionCount = 0;
  let pongCount = 0;

  const server = http.createServer((_request, response) => {
    response.writeHead(426, { Connection: 'close' });
    response.end();
  });

  server.on('upgrade', (request, socket, head) => {
    const key = request.headers['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.destroy();
      return;
    }
    const accept = createHash('sha1').update(key + HANDSHAKE_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    connectionCount += 1;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));

    const fragments: Buffer[] = [];
    const handle = (frame: ClientFrame): void => {
      if (frame.opcode === OPCODE_PONG) {
        pongCount += 1;
        return;
      }
      if (frame.opcode === OPCODE_PING) {
        socket.write(serverFrame(OPCODE_PONG, frame.payload, true));
        return;
      }
      if (frame.opcode === OPCODE_CLOSE) {
        socket.end(serverFrame(OPCODE_CLOSE, Buffer.alloc(0), true));
        return;
      }
      if (frame.opcode !== OPCODE_TEXT && frame.opcode !== OPCODE_CONTINUATION) {
        return;
      }
      if (!frame.final) {
        fragments.push(frame.payload);
        return;
      }
      const text = Buffer.concat([...fragments, frame.payload]).toString('utf8');
      fragments.length = 0;
      received.push(text);
      socket.write(serverFrame(OPCODE_TEXT, Buffer.from(text, 'utf8'), true));
    };

    const state = { buffer: Buffer.from(head) };
    const readAvailable = (): void => {
      for (;;) {
        const frame = readClientFrame(state);
        if (!frame) {
          return;
        }
        handle(frame);
      }
    };
    socket.on('data', (chunk: Buffer) => {
      state.buffer = Buffer.concat([state.buffer, chunk]);
      readAvailable();
    });
    socket.on('error', () => socket.destroy());
    socket.write(initialServerBytes());
    readAvailable();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the test WebSocket server did not bind to a TCP port');
  }

  return {
    url: `ws://127.0.0.1:${address.port}/`,
    received,
    connectionCount: () => connectionCount,
    pongCount: () => pongCount,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      sockets.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}