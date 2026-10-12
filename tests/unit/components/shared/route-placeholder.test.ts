/**
 * M19 S2 — behavioral tests for the shared RoutePlaceholder primitive and the
 * six route `loading.tsx` boundaries that compose it.
 *
 * These are real React renders (react-dom/server) of the actual application
 * components, not source-text scans — they assert rendered markup. The one
 * filesystem check (that each loading.tsx composes RoutePlaceholder) is a
 * Next.js boundary-wiring fact that cannot be expressed as a rendered prop.
 *
 * Contracts pinned (M19 plan 7.1–7.5):
 * - Exactly one polite loading status (role="status"); no competing live region.
 * - All decorative geometry is aria-hidden; the live region carries label text
 *   only (sr-only, so it is not part of the visual geometry).
 * - No fabricated value: no digits anywhere in the rendered markup.
 * - Server components: no "use client" directive, no hooks.
 * - All six target routes render their placeholder; the excluded public catalog
 *   routes have no loading.tsx.
 * - Session placeholder renders no bottom bar (mobile finish-bar frame intact).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RoutePlaceholder } from '@/components/shared/RoutePlaceholder';
import DashboardLoading from '@/app/(app)/dashboard/loading';
import ProgressLoading from '@/app/(app)/progress/loading';
import HistoryLoading from '@/app/(app)/history/loading';
import ExerciseHistoryLoading from '@/app/(app)/history/exercises/[slug]/loading';
import ProgramDetailLoading from '@/app/(app)/programs/[programSlug]/loading';
import SessionLoading from '@/app/(app)/programs/[programSlug]/weeks/[weekNumber]/workouts/[workoutOrder]/session/loading';

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

const routes = [
  { name: 'dashboard', Component: DashboardLoading, path: `${SRC}/app/(app)/dashboard/loading.tsx`, label: 'Loading your training' },
  { name: 'progress', Component: ProgressLoading, path: `${SRC}/app/(app)/progress/loading.tsx`, label: 'Loading progress' },
  { name: 'history', Component: HistoryLoading, path: `${SRC}/app/(app)/history/loading.tsx`, label: 'Loading training history' },
  { name: 'exercise history', Component: ExerciseHistoryLoading, path: `${SRC}/app/(app)/history/exercises/[slug]/loading.tsx`, label: 'Loading exercise history' },
  { name: 'program detail', Component: ProgramDetailLoading, path: `${SRC}/app/(app)/programs/[programSlug]/loading.tsx`, label: 'Loading program details' },
  { name: 'session', Component: SessionLoading, path: `${SRC}/app/(app)/programs/[programSlug]/weeks/[weekNumber]/workouts/[workoutOrder]/session/loading.tsx`, label: 'Loading workout session' },
] as const;

describe('route loading boundaries (M19 S2)', () => {
  for (const route of routes) {
    describe(route.name, () => {
      const html = renderToStaticMarkup(createElement(route.Component));

      it('renders inside the shared page container', () => {
        expect(html).toContain('max-w-[1120px]');
      });

      it('exposes exactly one polite loading status', () => {
        expect(html.match(/role="status"/g) ?? []).toHaveLength(1);
        expect(html).toContain(route.label);
      });

      it('hides decorative geometry and fabricates no readable values', () => {
        const text = html.replace(/<[^>]*>/g, ' ');
        expect(text).not.toMatch(/\d/);
        expect(html.match(/aria-hidden="true"/g) ?? []).not.toHaveLength(0);
      });

      it('renders substantive placeholder geometry', () => {
        expect(html.match(/bg-surface-2\/50/g) ?? []).not.toHaveLength(0);
      });

      it('composes the shared primitive (Next.js boundary wiring)', () => {
        expect(readFileSync(route.path, 'utf8')).toContain('RoutePlaceholder');
      });

      it('is a server component (no client boundary)', () => {
        const source = readFileSync(route.path, 'utf8');
        const firstCodeLine = source.split('\n').find((line) => line.trim().length > 0) ?? '';
        expect(firstCodeLine).not.toMatch(/^['"]use (client|server)['"]/);
      });
    });
  }

  it('the session placeholder renders no bottom action bar of its own', () => {
    const html = renderToStaticMarkup(createElement(SessionLoading));
    expect(html).not.toContain('aria-label="Primary"');
    expect(html).not.toContain('fixed inset-x-0 bottom-0');
  });
});

describe('excluded public catalog routes (M19 S2)', () => {
  it('have no loading.tsx — latency UI there would be novelty, not value', () => {
    for (const path of [`${SRC}/app/(app)/exercises/loading.tsx`, `${SRC}/app/(app)/programs/loading.tsx`]) {
      let missing = false;
      try {
        readFileSync(path, 'utf8');
      } catch {
        missing = true;
      }
      expect(missing).toBe(true);
    }
  });
});

