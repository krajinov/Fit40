/**
 * M19 S4 review fix (P3) — bottom-bar coverage, source-level + composition.
 *
 * WHAT THIS FILE PROVES (source-level): which files can render a viewport-bottom
 * surface, that the session finish bar is composed only by the Active Workout
 * screen, and that the completed-session panel and the History feature compose
 * none of their own.
 *
 * WHAT THIS FILE DOES NOT PROVE: any browser rendering. The runtime bar
 * presence/absence per route (`/dashboard`, `/history`, `/history/sessions/<id>`,
 * `/programs/…/session`) is covered by the jsdom composition tests in
 * `tests/unit/components/shared/mobile-tab-bar.test.ts`; the measured browser
 * matrix lives in `docs/milestones/milestone-19-s4-report.md`.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { hasFixedBottomBar, stripComments } from '../helpers/fixed-bottom-scan';

const MOBILE_TAB_BAR = 'src/components/shared/MobileTabBar.tsx';
const SESSION_FINISH_BAR = 'src/features/sessions/components/SessionFinishBar.tsx';
const ACTIVE_WORKOUT_SCREEN = 'src/features/sessions/components/ActiveWorkoutScreen.tsx';

function read(file: string): string {
  return readFileSync(path.resolve(file), 'utf8');
}

function filesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : /\.tsx?$/.test(file) ? [file] : [];
  });
}

function filesDeclaringFixedBottomBar(root: string): string[] {
  return filesIn(root)
    .filter((file) => hasFixedBottomBar(read(file)))
    .sort();
}

describe('fixed-bottom scanner — detects every declaration form (P3)', () => {
  it('detects a plain className attribute', () => {
    expect(hasFixedBottomBar('<div className="fixed inset-x-0 bottom-0 z-50" />')).toBe(true);
  });

  it('detects single-quoted and template-literal class names', () => {
    expect(hasFixedBottomBar("<div className={'fixed bottom-0'} />")).toBe(true);
    expect(hasFixedBottomBar('<div className={`fixed inset-x-0 ${extra} bottom-0`} />')).toBe(true);
  });

  it('detects class helpers whose utilities are split across literals', () => {
    expect(hasFixedBottomBar("className={cn('fixed inset-x-0', active && 'bottom-0')}")).toBe(true);
    expect(hasFixedBottomBar("className={clsx('inset-x-0 bottom-0', 'fixed')}")).toBe(true);
  });

  it('does not match non-fixed positioning, other tokens or commented code', () => {
    expect(hasFixedBottomBar('<div className="absolute inset-x-0 bottom-0" />')).toBe(false);
    expect(hasFixedBottomBar('<div className="fixed inset-x-0 top-0" />')).toBe(false);
    expect(hasFixedBottomBar('<div className="sticky bottom-0" />')).toBe(false);
    expect(hasFixedBottomBar('<div className="pb-0 inset-bottom-0" />')).toBe(false);
    expect(hasFixedBottomBar('// className="fixed inset-x-0 bottom-0"')).toBe(false);
    expect(hasFixedBottomBar('/* className="fixed inset-x-0 bottom-0" */')).toBe(false);
  });

  it('strips block and line comments before scanning', () => {
    expect(stripComments('a /* fixed bottom-0 */ b // fixed bottom-0\nc')).not.toMatch(/fixed/);
  });
});

describe('M19 S4 — exactly two viewport-bottom surfaces exist in src', () => {
  it('finds the tab bar and the session finish bar, and nothing else', () => {
    expect(filesDeclaringFixedBottomBar('src')).toEqual([MOBILE_TAB_BAR, SESSION_FINISH_BAR].sort());
  });

  it('composes the finish bar only from the Active Workout screen', () => {
    const composers = filesIn('src').filter((file) => read(file).includes('<SessionFinishBar'));
    expect(composers.sort()).toEqual([ACTIVE_WORKOUT_SCREEN].sort());
  });
});

describe('M19 S4 — bottom bars per session screen state (composition, source level)', () => {
  it('active session: the screen composes the finish bar, the tab bar hides itself', () => {
    // The bar itself (already proven above) plus the `/session` hide means the
    // active-workout screen shows exactly one bottom bar. The hide is a runtime
    // guarantee, asserted in mobile-tab-bar.test.ts.
    expect(read(ACTIVE_WORKOUT_SCREEN)).toContain('<SessionFinishBar');
    expect(read(MOBILE_TAB_BAR)).toContain("endsWith('/session')");
  });

  it('completed session: the completed panel composes no bottom bar of its own', () => {
    // Same route, different state: no finish bar is rendered, so the screen has
    // ZERO bottom bars — never two competing bars and no overlap.
    const panel = read('src/features/sessions/components/SessionCompletedPanel.tsx');
    expect(hasFixedBottomBar(panel)).toBe(false);
    expect(panel).not.toContain('<SessionFinishBar');
  });

  it('history detail: nothing under features/history renders a bottom bar', () => {
    // The tab bar is therefore the single bottom bar on /history/sessions/<id>
    // (runtime presence asserted in mobile-tab-bar.test.ts).
    expect(filesDeclaringFixedBottomBar('src/features/history')).toEqual([]);
    expect(filesDeclaringFixedBottomBar('src/app/(app)/history')).toEqual([]);
  });
});
