/**
 * M19 S1 architecture guard: error boundary integrity.
 *
 * Locks the properties that must remain true regardless of copy edits:
 *  - P1: every boundary recovers via the framework `retry` prop (fresh Server
 *        Component response), never `reset` alone.
 *  - P2: segment boundaries use a non-landmark container (their route-group
 *        layout already owns the single <main>); the global fallback keeps the
 *        <main> because it owns the entire HTML document.
 *  - No internal error detail (error.message / stack) is ever rendered.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APP_ERROR = 'src/app/(app)/error.tsx';
const AUTH_ERROR = 'src/app/(auth)/error.tsx';
const GLOBAL_ERROR = 'src/app/global-error.tsx';

function read(relPath: string): string {
  return readFileSync(resolve(process.cwd(), relPath), 'utf8');
}

describe('M19 S1 error boundary files exist', () => {
  it('creates the three required boundaries', () => {
    expect(existsSync(resolve(process.cwd(), APP_ERROR))).toBe(true);
    expect(existsSync(resolve(process.cwd(), AUTH_ERROR))).toBe(true);
    expect(existsSync(resolve(process.cwd(), GLOBAL_ERROR))).toBe(true);
  });
});

describe('M19 S1 P1 — recovery uses the framework retry prop', () => {
  for (const relPath of [APP_ERROR, AUTH_ERROR, GLOBAL_ERROR]) {
    it(`${relPath} destructures retry and wires it to the recovery control`, () => {
      const src = read(relPath);
      expect(src).toMatch(/\bretry\b/);
      // The recovery control's onClick must be the framework `retry` prop, which
      // the framework implements as context.refresh()+reset() (a FRESH Server
      // Component response) — never `reset()` alone.
      expect(src).toMatch(/onClick=\{[^}]*\bretry\b/);
    });

    it(`${relPath} never wires the recovery control to reset() alone`, () => {
      const src = read(relPath);
      // Guard the regression this slice fixed: reset() only clears the boundary
      // and can replay the same failed Server Component response.
      expect(src).not.toMatch(/onClick=\{\s*reset\s*\}/);
    });
  }

  it('no boundary relies on reset() as the recovery mechanism', () => {
    for (const relPath of [APP_ERROR, AUTH_ERROR, GLOBAL_ERROR]) {
      const src = read(relPath);
      // `retry` is the recovery action; `reset` must not be the button handler.
      expect(src).not.toMatch(/onRetry=\{\s*reset\s*\}/);
    }
  });

  it('marks each boundary as a Client Component', () => {
    for (const relPath of [APP_ERROR, AUTH_ERROR, GLOBAL_ERROR]) {
      expect(read(relPath).trimStart().startsWith("'use client'") ||
        read(relPath).trimStart().startsWith('"use client"')).toBe(true);
    }
  });
});

describe('M19 S1 P2 — single main landmark rule', () => {
  it('segment boundaries use a non-landmark container, not <main>', () => {
    for (const relPath of [APP_ERROR, AUTH_ERROR]) {
      const src = read(relPath);
      // The route-group layout already provides the <main>.
      expect(src).not.toMatch(/<main[\s>]/);
    }
  });

  it('global fallback owns the full document and keeps its <main>', () => {
    const src = read(GLOBAL_ERROR);
    expect(src).toMatch(/<html[\s>]/);
    expect(src).toMatch(/<body[\s>]/);
    expect(src).toMatch(/<main[\s>]/);
  });
});

describe('M19 S1 — no internal error detail leaks into UI', () => {
  for (const relPath of [APP_ERROR, AUTH_ERROR, GLOBAL_ERROR]) {
    it(`${relPath} never renders error.message or a stack`, () => {
      const src = read(relPath);
      expect(src).not.toMatch(/error\.message/);
      expect(src).not.toMatch(/error\.stack/);
      expect(src).not.toMatch(/\{error\}/);
    });
  }
});
