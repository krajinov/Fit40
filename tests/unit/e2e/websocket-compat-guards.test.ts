/**
 * Regression guards that stop the CDP WebSocket compatibility problem from
 * returning silently (M19 S4 review fix, P2).
 *
 * 1. BYTE LEVEL: the dependency-free RFC 6455 codec masks client frames,
 *    reassembles fragmented messages, surfaces control frames and tolerates a
 *    frame split across arbitrary chunk boundaries.
 * 2. SOURCE LEVEL: `cdp.mjs` never constructs the global WebSocket, the global
 *    is only reached behind a `typeof` guard, the E2E runner keeps its explicit
 *    runtime compatibility check and printed transport label, no WebSocket
 *    dependency was added, and the Next.js Node floor the transport has to cover
 *    is still 20.9.
 * The functional handshake and round-trip coverage lives in
 * `./websocket-transport.test.ts`.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { OPCODE, createFrameParser, encodeFrame } from '../../e2e/support/websocket-frames.mjs';

const CDP_SOURCE = 'tests/e2e/support/cdp.mjs';
const TRANSPORT_SOURCE = 'tests/e2e/support/websocket.mjs';
const RUNNER_SOURCE = 'tests/e2e/mobile-header-focus-order.mjs';
const NEXT_MANIFEST = 'node_modules/next/package.json';

/** Source with comments stripped, so prose can never satisfy a guard. */
function source(file: string): string {
  return readFileSync(path.resolve(file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe("WebSocket frame codec (the fallback transport's byte layer)", () => {
  interface ParsedEvent {
    kind?: string;
    payload?: Buffer;
  }

  /** Minimal unmasked server-style frame, written independently of the codec. */
  function wireFrame(opcode: number, payload: string, final: boolean): Buffer {
    const body = Buffer.from(payload, 'utf8');
    return Buffer.concat([Buffer.from([opcode | (final ? 0x80 : 0x00), body.length]), body]);
  }

  it('masks client frames, as RFC 6455 requires', () => {
    const frame: Buffer = encodeFrame(OPCODE.text, Buffer.from('x', 'utf8'));
    expect(frame.readUInt8(0)).toBe(0x81); // FIN + text
    expect(frame.readUInt8(1) & 0x80).toBe(0x80); // MASK bit set
    expect(frame.length).toBe(2 + 4 + 1); // header + key + masked byte
  });

  it('joins a fragmented server message and surfaces control frames', () => {
    const parser = createFrameParser();
    const events: ParsedEvent[] = parser.push(
      Buffer.concat([
        wireFrame(OPCODE.text, 'frag-', false),
        wireFrame(OPCODE.continuation, 'mented', true),
        wireFrame(OPCODE.ping, 'p', true),
      ]),
    );

    expect(events.map((event) => event.kind)).toEqual(['message', 'ping']);
    expect(events[0]?.payload?.toString('utf8')).toBe('frag-mented');
    expect(events[1]?.payload?.toString('utf8')).toBe('p');
  });

  it('parses a frame that arrives one byte at a time', () => {
    const parser = createFrameParser();
    const frame: Buffer = encodeFrame(OPCODE.text, Buffer.from('{"id":1}', 'utf8'));
    const events: ParsedEvent[] = [];
    for (const byte of frame) {
      events.push(...parser.push(Buffer.from([byte])));
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('message');
    expect(events[0]?.payload?.toString('utf8')).toBe('{"id":1}');
  });

  it('rejects a continuation frame that starts a message', () => {
    const parser = createFrameParser();
    expect(() => parser.push(wireFrame(OPCODE.continuation, 'orphan', true))).toThrow(
      /continuation frame without a started message/,
    );
  });
});

describe('transport source guards', () => {
  it('never constructs the global WebSocket in the CDP client', () => {
    const cdp = source(CDP_SOURCE);
    expect(cdp).not.toMatch(/\bnew\s+WebSocket\s*\(/);
    expect(cdp).not.toMatch(/globalThis\.WebSocket/);
    expect(cdp).toMatch(/\bopenWebSocket\b/);
  });

  it('reaches for the global only behind a typeof guard', () => {
    expect(source(TRANSPORT_SOURCE)).toMatch(/typeof\s+globalThis\.WebSocket\s*===\s*'function'/);
  });

  it('keeps the E2E runner runtime check and its printed transport label', () => {
    const runner = source(RUNNER_SOURCE);
    expect(runner).toMatch(/assertWebsocketTransport\(\)/);
    expect(runner).toMatch(/transport\.label/);
  });

  it('adds no WebSocket dependency for the harness to carry', () => {
    const declared: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } =
      JSON.parse(readFileSync(path.resolve('package.json'), 'utf8'));
    const names = [...Object.keys(declared.dependencies ?? {}), ...Object.keys(declared.devDependencies ?? {})];
    expect(names.filter((name) => /^(ws|websocket|isomorphic-ws|undici)$/.test(name))).toEqual([]);
  });

  it.skipIf(!existsSync(NEXT_MANIFEST))('covers the Node floor Next.js actually requires', () => {
    const manifest: { engines?: { node?: string } } = JSON.parse(
      readFileSync(path.resolve(NEXT_MANIFEST), 'utf8'),
    );
    // The floor is what makes this whole file necessary: >= 20.9.0 predates the
    // WebSocket global (behind a flag in 20.10.0/21.0.0, on by default in 22.0.0).
    expect(manifest.engines?.node).toBe('>=20.9.0');
  });
});
