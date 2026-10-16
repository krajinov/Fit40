/**
 * RFC 6455 frame codec and parser — the byte-level half of the dependency-free
 * WebSocket fallback used by `./websocket.mjs`.
 *
 * Split out of `websocket.mjs` so each file stays small and so the parser can be
 * unit-tested on its own (see `tests/unit/e2e/websocket-transport.test.ts`).
 *
 * Only what the Chrome DevTools Protocol needs is implemented: unmasked server
 * frames, masked client frames, message fragmentation and the ping/pong/close
 * control frames. Extensions (permessage-deflate) and `wss://` are not.
 */
import { randomBytes } from 'node:crypto';

export const OPCODE = {
  continuation: 0x0,
  text: 0x1,
  binary: 0x2,
  close: 0x8,
  ping: 0x9,
  pong: 0xa,
};

/** XORs `payload` with a 4-byte WebSocket masking key. */
export function maskPayload(payload, key) {
  const masked = Buffer.allocUnsafe(payload.length);
  for (let i = 0; i < payload.length; i += 1) {
    masked[i] = payload[i] ^ key[i % 4];
  }
  return masked;
}

/**
 * Encodes one client→server frame. Client frames are always masked and this
 * codec never fragments, which is all the CDP client needs (small JSON texts).
 */
export function encodeFrame(opcode, payload = Buffer.alloc(0)) {
  const maskKey = randomBytes(4);
  const header = [0x80 | opcode]; // FIN + opcode, no RSV bits.
  if (payload.length < 126) {
    header.push(0x80 | payload.length);
  } else if (payload.length < 0x10000) {
    header.push(0x80 | 126, (payload.length >> 8) & 0xff, payload.length & 0xff);
  } else {
    const extended = Buffer.alloc(8);
    extended.writeBigUInt64BE(BigInt(payload.length));
    header.push(0x80 | 127, ...extended);
  }
  header.push(...maskKey);
  return Buffer.concat([Buffer.from(header), maskPayload(payload, maskKey)]);
}

/**
 * Incremental frame parser. `push(chunk)` returns the complete events that
 * became available, so a caller can feed it raw socket reads.
 *
 * Events: `{ kind: 'message', opcode, payload }` (fragments already joined),
 * `{ kind: 'ping' | 'pong', payload }` and `{ kind: 'close', payload }`.
 * Protocol violations throw; the caller turns those into an `error` event.
 */
export function createFrameParser({ maxPayloadBytes = 64 * 1024 * 1024 } = {}) {
  let buffered = Buffer.alloc(0);
  let fragments = [];
  let fragmentedOpcode = null;

  function readFrame() {
    if (buffered.length < 2) {
      return null;
    }
    const first = buffered[0];
    const second = buffered[1];
    if ((first & 0x70) !== 0) {
      throw new Error('reserved bits must be zero (no extensions are negotiated)');
    }
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buffered.length < offset + 2) {
        return null;
      }
      length = buffered.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buffered.length < offset + 8) {
        return null;
      }
      const length64 = buffered.readBigUInt64BE(offset);
      if (length64 > BigInt(maxPayloadBytes)) {
        throw new Error('frame exceeds the payload limit');
      }
      length = Number(length64);
      offset += 8;
    }
    if (length > maxPayloadBytes) {
      throw new Error('frame exceeds the payload limit');
    }
    let maskKey = null;
    if (masked) {
      if (buffered.length < offset + 4) {
        return null;
      }
      maskKey = buffered.subarray(offset, offset + 4);
      offset += 4;
    }
    if (buffered.length < offset + length) {
      return null;
    }
    const payload = buffered.subarray(offset, offset + length);
    buffered = buffered.subarray(offset + length);
    return { fin, opcode, payload: maskKey ? maskPayload(payload, maskKey) : payload };
  }

  function toEvent(frame) {
    const { fin, opcode, payload } = frame;
    if (opcode === OPCODE.continuation) {
      if (fragmentedOpcode === null) {
        throw new Error('continuation frame without a started message');
      }
      fragments.push(payload);
      if (!fin) {
        return null;
      }
      const messageOpcode = fragmentedOpcode;
      const payloadJoined = Buffer.concat(fragments);
      fragments = [];
      fragmentedOpcode = null;
      return { kind: 'message', opcode: messageOpcode, payload: payloadJoined };
    }
    if (opcode === OPCODE.text || opcode === OPCODE.binary) {
      if (fragmentedOpcode !== null) {
        throw new Error('data frame inside a fragmented message');
      }
      if (fin) {
        return { kind: 'message', opcode, payload };
      }
      fragmentedOpcode = opcode;
      fragments = [payload];
      return null;
    }
    if (opcode === OPCODE.ping) {
      return { kind: 'ping', payload };
    }
    if (opcode === OPCODE.pong) {
      return { kind: 'pong', payload };
    }
    if (opcode === OPCODE.close) {
      return { kind: 'close', payload };
    }
    throw new Error(`unsupported opcode 0x${opcode.toString(16)}`);
  }

  return {
    push(chunk) {
      buffered = Buffer.concat([buffered, chunk]);
      const events = [];
      for (;;) {
        const frame = readFrame();
        if (!frame) {
          return events;
        }
        const event = toEvent(frame);
        if (event) {
          events.push(event);
        }
      }
    },
  };
}