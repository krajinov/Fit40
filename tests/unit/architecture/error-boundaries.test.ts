/**
 * M19 S1 — architecture guards for the recoverable error boundaries.
 *
 * These lock the STRUCTURAL contracts that the behavioral component tests
 * (error-state.test.ts) assume, using the repository's source-scan idiom:
 *
 *  - Every boundary is a Client Component (`'use client'`) — required because
 *    it owns `reset()` and a `useEffect` logger.
 *  - No boundary ever renders the raw error (`error.message`, `String(error)`,
 *    `error.stack`, `error.digest`) — privacy / no-leak contract.
 *  - Each boundary logs via `console.error` (established project convention).
 *  - `global-error.tsx` supplies its own `<html>`/`<body>` and lang (it renders
 *    when the root layout has already failed).
 *  - Segment boundaries do NOT re-render the root shell; they render a single
 *    `<main>` wrapping the shared `ErrorState`.
 *  - Exactly one segment boundary per route group, and `ErrorState` is the only
 *    shared primitive; no new dependency is introduced.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(file: string): string {
  return readFileSync(path.resolve(file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const APP_BOUNDARY = 'src/app/(app)/error.tsx';
const AUTH_BOUNDARY = 'src/app/(auth)/error.tsx';
const GLOBAL_BOUNDARY = 'src/app/global-error.tsx';
const ERROR_STATE = 'src/components/shared/ErrorState.tsx';

const BOUNDARIES = [APP_BOUNDARY, AUTH_BOUNDARY, GLOBAL_BOUNDARY];

describe('M19 S1 error-boundary guards', () => {
  it('makes every boundary a Client Component that owns reset() and a logger', () => {
    for (const file of BOUNDARIES) {
      const text = source(file);
      expect(text, file).toMatch(/['"]use client['"]/);
      expect(text, file).toContain('console.error(');
      expect(text, file).toMatch(/reset/);
    }
  });

  it('never renders the raw error object (no internal detail leaks)', () => {
    for (const file of BOUNDARIES) {
      const text = source(file);
      expect(text, file).not.toMatch(/error\.message/);
      expect(text, file).not.toMatch(/error\.stack/);
      expect(text, file).not.toMatch(/error\.digest/);
      expect(text, file).not.toMatch(/String\(error\)/);
      expect(text, file).not.toMatch(/\{error\}/);
      expect(text, file).not.toMatch(/\{error\b/);
    }
  });

  it('gives the global boundary a self-contained html/body shell', () => {
    const text = source(GLOBAL_BOUNDARY);
    expect(text).toContain('<html');
    expect(text).toContain('<body');
    expect(text).toContain('lang="en"');
    // It must not rely on the (failed) root layout's fonts/stylesheet.
    expect(text).not.toContain('globals.css');
  });

  it('renders a single <main> around the shared ErrorState in segment boundaries', () => {
    for (const file of [APP_BOUNDARY, AUTH_BOUNDARY]) {
      const text = source(file);
      expect(text, file).toContain('<main');
      expect(text, file).toContain('ErrorState');
      // Segment boundaries must NOT reproduce the document shell.
      expect(text, file).not.toContain('<html');
    }
  });

  it('keeps ErrorState presentational — it never receives or renders an error', () => {
    const text = source(ERROR_STATE);
    expect(text).not.toMatch(/error/);
    expect(text).toContain('title');
  });

  it('introduces no new dependency (only existing primitives are imported)', () => {
    for (const file of BOUNDARIES) {
      const text = source(file);
      // Boundaries may import React, the shared ErrorState and the existing Button.
      for (const match of text.matchAll(/from '([^']+)'/g)) {
        expect(match[1], file).toMatch(
          /^(react|@\/components\/shared\/ErrorState|@\/components\/ui\/button)$/,
        );
      }
    }
  });
});
