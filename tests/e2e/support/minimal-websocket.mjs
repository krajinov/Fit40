/**
 * Minimal WHATWG-shaped WebSocket — the dependency-free fallback the CDP E2E
 * harness uses when the runtime has no global `WebSocket` (M19 S4 review fix,
 * P2; the transport selection and the reason it is needed live in
 * `./websocket.mjs`).
 *
 * Built on `node:http` + `node:crypto` plus the RFC 6455 codec in
 * `./websocket-frames.mjs`. It exposes only the slice of the WHATWG API the CDP
 * client drives: `addEventListener('open' | 'message' | 'error' | 'close')`,
 * `send` and `close`. Events are dispatched from microtasks, like the real
 * implementation, so a listener registered inside the `open` handler still sees
 * messages that arrived with the handshake response.
 *
 * LIMITATION: `ws://` only. Chrome's DevTools endpoint is always
 * `ws://127.0.0.1:<port>/devtools/...`, so this cannot be reached in practice;
 * `wss://` throws a labelled error instead of failing obscurely.
 */
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';

import { OPCODE, createFrameParser, encodeFrame } from './websocket-frames.mjs';

/** RFC 6455 handshake magic value. */
const HANDSHAKE_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function expectedAccept(key) {
  return createHash('sha1').update(key + HANDSHAKE_GUID).digest('base64');
}

export class MinimalWebSocket {
  constructor(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'ws:') {
      throw new Error(
        `the dependency-free WebSocket fallback supports ws:// only, received ${parsed.protocol}//`,
      );
    }
    this.listeners = { open: [], message: [], error: [], close: [] };
    this.socket = null;
    this.parser = createFrameParser();
    this.pending = [];
    this.drainScheduled = false;
    this.closed = false;
    this.closeEmitted = false;
    this.handshake(parsed);
  }

  addEventListener(type, handler, { once = false } = {}) {
    const bucket = this.listeners[type];
    if (bucket) {
      bucket.push({ handler, once });
    }
  }

  send(data) {
    if (this.closed || !this.socket) {
      throw new Error('cannot send on a WebSocket that is not open');
    }
    if (typeof data === 'string') {
      this.socket.write(encodeFrame(OPCODE.text, Buffer.from(data, 'utf8')));
    } else if (ArrayBuffer.isView(data)) {
      this.socket.write(
        encodeFrame(OPCODE.binary, Buffer.from(data.buffer, data.byteOffset, data.byteLength)),
      );
    } else {
      this.socket.write(encodeFrame(OPCODE.binary, Buffer.from(data)));
    }
  }

  close() {
    if (!this.closed) {
      this.writeFrame(OPCODE.close, Buffer.alloc(0));
    }
    this.shutdown();
    this.emitClose(1000, 'closed by the client');
  }

  /** Runs the HTTP Upgrade handshake and adopts the socket on success. */
  handshake(parsed) {
    const key = randomBytes(16).toString('base64');
    const request = http.request({
      hostname: parsed.hostname,
      port: parsed.port === '' ? 80 : Number(parsed.port),
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers: {
        Host: parsed.host,
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': key,
      },
    });
    request.on('upgrade', (response, socket, head) => {
      if (response.headers['sec-websocket-accept'] !== expectedAccept(key)) {
        socket.destroy();
        this.emit('error', new Error('the server returned an invalid Sec-WebSocket-Accept header'));
        return;
      }
      this.socket = socket;
      socket.setNoDelay(true);
      socket.on('data', (chunk) => {
        this.pending.push(chunk);
        this.schedule();
      });
      socket.on('error', (error) => this.emit('error', error));
      socket.on('close', () => {
        if (this.closed) {
          return;
        }
        this.closed = true;
        this.emitClose(1006, 'the connection closed unexpectedly');
      });
      if (head && head.length > 0) {
        this.pending.push(head);
      }
      this.emit('open', {});
      this.schedule();
    });
    request.on('response', (response) => {
      response.resume();
      this.emit(
        'error',
        new Error(`the WebSocket handshake was refused with HTTP ${response.statusCode}`),
      );
    });
    request.on('error', (error) => this.emit('error', error));
    request.end();
  }

  /**
   * Dispatches buffered frames from a microtask, in arrival order, so a listener
   * registered in the `open` handler cannot miss handshake-packet data.
   */
  schedule() {
    if (this.drainScheduled) {
      return;
    }
    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      const chunks = this.pending;
      this.pending = [];
      for (const chunk of chunks) {
        this.consume(chunk);
      }
    });
  }

  consume(chunk) {
    let events;
    try {
      events = this.parser.push(chunk);
    } catch (error) {
      this.emit('error', error);
      this.shutdown();
      return;
    }
    for (const event of events) {
      if (event.kind === 'message') {
        const data = event.opcode === OPCODE.binary ? event.payload : event.payload.toString('utf8');
        this.emit('message', { data });
      } else if (event.kind === 'ping') {
        this.writeFrame(OPCODE.pong, event.payload);
      } else if (event.kind === 'close') {
        this.shutdown();
        this.emitClose(1000, 'the server closed the connection');
      }
    }
  }

  writeFrame(opcode, payload) {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(encodeFrame(opcode, payload));
    }
  }

  shutdown() {
    this.closed = true;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  emitClose(code, reason) {
    if (this.closeEmitted) {
      return;
    }
    this.closeEmitted = true;
    this.emit('close', { code, reason });
  }

  emit(type, event) {
    const bucket = this.listeners[type] ?? [];
    this.listeners[type] = bucket.filter((entry) => !entry.once);
    for (const entry of bucket) {
      entry.handler(event);
    }
  }
}
