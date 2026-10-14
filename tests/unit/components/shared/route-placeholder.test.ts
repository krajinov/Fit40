/**
 * M19 S2 — behavioral tests for the shared RoutePlaceholder primitive, plus the
 * review-fix guards (P2): no segment `loading.tsx` boundary may exist anywhere
 * under src/app, and the private pages must compose RoutePlaceholder as an
 * explicit Suspense fallback around only their slow success-path content.
 *
 * These are real React renders (react-dom/server) of the actual application
 * components, not source-text scans — except the two Next.js boundary-wiring
 * facts that cannot be expressed as a rendered prop (no loading.tsx on disk;
 * which module composes the fallback).
 *
 * Contracts pinned (M19 plan 7.1–7.5 + the P2 review fix):
 * - Exactly one polite loading status (role="status"); no competing live region.
 * - All decorative geometry is aria-hidden; the live region carries label text
 *   only (sr-only, so it is not part of the visual geometry).
 * - No fabricated value: no digits anywhere in the rendered markup.
 * - Server components: no "use client" directive, no hooks.
 * - No `loading.tsx` remains anywhere (it committed HTTP 200 before the pages'
 *   redirect()/notFound() could run — see loading-boundary-status.test.ts for
 *   the behavioral status contracts).
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RoutePlaceholder } from '@/components/shared/RoutePlaceholder';

// Vitest runs from the repository root (the `global-setup` path convention);
// resolve the source root from cwd so the tests are checkout-location agnostic.
const SRC = path.join(process.cwd(), 'src');

describe('RoutePlaceholder (M19 S2)', () => {
  it('renders exactly one polite loading status carrying the label', () => {
    const html = renderToStaticMarkup(createElement(RoutePlaceholder, { label: 'Loading your training' }));
    expect(html.match(/role="status"/g) ?? []).toHaveLength(1);
    expect(html).toContain('Loading your training');
  });

  it('hides all decorative geometry from assistive technology', () => {
    const html = renderToStaticMarkup(
      createElement(RoutePlaceholder, { label: 'Loading', blocks: ['h-24', 'h-40'] }),
    );
    expect(html.match(/aria-hidden="true"/g) ?? []).toHaveLength(2);
    expect(html).not.toContain('aria-live="assertive"');
  });

  it('fabricates no value in its text: no digit a user could read', () => {
    const html = renderToStaticMarkup(
      createElement(RoutePlaceholder, { label: 'Loading progress', blocks: ['h-9 w-56', 'h-72', 'h-32'] }),
    );
    // Geometry lives entirely in class attributes; only the label is text.
    const text = html.replace(/<[^>]*>/g, ' ');
    expect(text).not.toMatch(/\d/);
  });

  it('renders one decorative surface block per requested block', () => {
    const html = renderToStaticMarkup(
      createElement(RoutePlaceholder, { label: 'Loading', blocks: ['h-24', 'h-24', 'h-24'] }),
    );
    expect(html.match(/bg-surface-2\/50/g) ?? []).toHaveLength(3);
  });

  it('is a server component (no client directive, no hooks)', () => {
    const source = readFileSync(`${SRC}/components/shared/RoutePlaceholder.tsx`, 'utf8');
    // A real directive is a leading 'use client'/'use server' statement; the
    // word may legitimately appear in prose. Assert on the first code line.
    const firstCodeLine = source.split('\n').find((line) => line.trim().length > 0) ?? '';
    expect(firstCodeLine).not.toMatch(/^['"]use (client|server)['"]/);
    expect(source).not.toMatch(/\buse(State|Effect|Ref|Memo|Callback)\b/);
  });
});

/** Every `loading.tsx` under src/app, as repository-relative paths. */
function loadingFiles(directory = 'src/app'): string[] {
  return readdirSync(path.join(process.cwd(), directory), { withFileTypes: true }).flatMap((entry) => {
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) return loadingFiles(file);
    return entry.name === 'loading.tsx' ? [file] : [];
  });
}

describe('M19 S2 review fix — no segment loading boundary remains', () => {
  it('finds zero loading.tsx anywhere under src/app', () => {
    // A segment `loading.tsx` flushes HTTP 200 before the page's own
    // redirect()/notFound() can run, which turned signed-out private requests
    // into 200s and /programs/unknown into 200 instead of 404 (PR #25 review).
    // The pages now own their streaming via explicit Suspense boundaries.
    expect(loadingFiles()).toEqual([]);
  });
});

const streamedPages = [
  { name: 'dashboard', path: `${SRC}/app/(app)/dashboard/page.tsx`, label: 'Loading your training' },
  { name: 'progress', path: `${SRC}/app/(app)/progress/page.tsx`, label: 'Loading progress' },
  { name: 'history', path: `${SRC}/app/(app)/history/page.tsx`, label: 'Loading training history' },
  {
    name: 'program detail',
    path: `${SRC}/app/(app)/programs/[programSlug]/page.tsx`,
    label: 'Loading program details',
  },
  {
    name: 'session',
    path: `${SRC}/app/(app)/programs/[programSlug]/weeks/[weekNumber]/workouts/[workoutOrder]/session/page.tsx`,
    label: 'Loading workout session',
  },
] as const;

describe('streaming pages compose the shared placeholder as their Suspense fallback', () => {
  for (const page of streamedPages) {
    it(`${page.name} streams RoutePlaceholder behind an explicit Suspense boundary`, () => {
      const source = readFileSync(page.path, 'utf8');
      expect(source).toContain('RoutePlaceholder');
      expect(source).toContain('Suspense');
      expect(source).toContain(page.label);
      const firstCodeLine = source.split('\n').find((line) => line.trim().length > 0) ?? '';
      expect(firstCodeLine).not.toMatch(/^['"]use (client|server)['"]/);
    });
  }

  it('exercise history deliberately has no Suspense boundary and no placeholder', () => {
    // Its whole view build is already awaited by generateMetadata before the
    // head flushes, so a boundary could not fire before content; keeping the
    // page boundary-free is what preserves the native 307/404 statuses.
    const source = readFileSync(`${SRC}/app/(app)/history/exercises/[slug]/page.tsx`, 'utf8');
    expect(source).not.toContain('Suspense');
    expect(source).not.toContain('RoutePlaceholder');
  });
});

