/**
 * @vitest-environment jsdom
 *
 * Screen-level regression tests for the Active Workout's consumption of a
 * CANONICALLY REORDERED session DTO (M10 Slice 5 invariant → Slice 6 UI):
 * `exerciseLogs[index].order === index + 1`, so the screen must render the
 * cards in the DTO array order, label them with that order, mark the active
 * exercise by the reordered array, and keep each occurrence's skipped /
 * substituted / logged-set state attached to its own occurrence — without
 * EVER sorting the logs in Presentation (a need to sort would indicate a
 * Domain regression and must fail loudly here).
 *
 * Rendered with react-dom (React 19 act). The interactive client islands
 * (logger, set rows, swap/adjust panels, finish bar) and the header are
 * stubbed at their module boundaries — the contract under test is purely
 * the screen's ordering and attachment behavior.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/features/sessions/components/ActiveWorkoutHeader', () => ({
  ActiveWorkoutHeader: () => createElement('header', null, 'session header'),
}));

vi.mock('@/features/sessions/components/SetLoggerForm', () => ({
  SetLoggerForm: () => createElement('div', null, 'logger'),
}));

vi.mock('@/features/sessions/components/LoggedSetRow', () => ({
  LoggedSetRow: (props: { readonly valueLabel: string }) =>
    createElement('div', null, `set row ${props.valueLabel}`),
}));

vi.mock('@/features/sessions/components/SessionExerciseSwapPanel', () => ({
  SessionExerciseSwapPanel: () => createElement('div', null, 'swap panel'),
}));

vi.mock('@/features/sessions/components/SessionExerciseAdjustPanel', () => ({
  SessionExerciseAdjustPanel: (props: {
    readonly exerciseOrder: number;
    readonly adjustment: { readonly state: string; readonly canMoveUp: boolean; readonly canMoveDown: boolean };
  }) =>
    createElement(
      'div',
      null,
      `adjust ${props.exerciseOrder} ${props.adjustment.state} ` +
        `up:${props.adjustment.canMoveUp ? 'yes' : 'no'} ` +
        `down:${props.adjustment.canMoveDown ? 'yes' : 'no'}`,
    ),
}));

vi.mock('@/features/sessions/components/SessionFinishBar', () => ({
  SessionFinishBar: () => createElement('div', null, 'finish bar'),
}));

vi.mock('@/features/sessions/components/AddSessionExercisePanel', () => ({
  AddSessionExercisePanel: () => createElement('div', null, 'add exercise panel'),
}));

import type { ScheduledWorkoutDetailDto } from '@/application/dto/program';
import type {
  WorkoutSessionDto,
  WorkoutSessionExerciseDto,
  WorkoutSessionSetDto,
} from '@/application/dto/workout-session';
import {
  buildSessionExerciseCardViews,
  buildSessionProgress,
  type SessionExerciseCatalogMeta,
} from '@/features/sessions/active-workout-views';
import type { ActiveWorkoutView } from '@/features/sessions/active-workout-view';
import { ActiveWorkoutScreen } from '@/features/sessions/components/ActiveWorkoutScreen';

declare global {
  // React 19's act() environment flag; not part of the DOM lib typings.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { readonly container: HTMLElement; readonly root: Root }[] = [];

const threeByEightToTen = { type: 'reps' as const, sets: 3, minReps: 8, maxReps: 10 };

function repSet(setNumber: number, reps: number, weightKg: number): WorkoutSessionSetDto {
  return { setNumber, type: 'reps', reps, weightKg, rpe: null };
}

/** The adjustment eligibility of an in-progress occurrence. */
function eligibility(
  isSkipped: boolean,
  canMoveUp: boolean,
  canMoveDown: boolean,
  blockedBy: 'logged-sets' | null = null,
): WorkoutSessionExerciseDto['adjustmentEligibility'] {
  return {
    isSkipped,
    blockedBy,
    canSkip: !isSkipped && blockedBy === null,
    canUnskip: isSkipped && blockedBy === null,
    canMoveUp,
    canMoveDown,
  };
}

/** An in-progress occurrence of a THREE-occurrence session, mid-list by default. */
function log(
  order: number,
  exerciseId: string,
  sets: WorkoutSessionSetDto[],
  overrides: Partial<WorkoutSessionExerciseDto> = {},
): WorkoutSessionExerciseDto {
  return {
    authoredExerciseId: exerciseId,
    performedExerciseId: exerciseId,
    isSubstituted: false,
    isSkipped: false,
    // Defaults to the order (the fixture's implicit occurrenceKey); tests
    // that exercise reorder stability override it explicitly.
    occurrenceKey: order,
    source: 'template',
    substitutionEligibility: { blockedBy: null, canRestore: false },
    adjustmentEligibility: eligibility(false, order > 1, order < 3),
    order,
    prescription: threeByEightToTen,
    sets,
    ...overrides,
  };
}

const catalog = new Map<string, SessionExerciseCatalogMeta>([
  ['ex-b', { name: 'Exercise B', equipment: 'barbell' }],
  ['ex-a', { name: 'Exercise A', equipment: 'dumbbell' }],
  ['ex-c', { name: 'Exercise C', equipment: 'barbell' }],
  ['ex-d-alt', { name: 'Exercise D Alt', equipment: 'dumbbell' }],
  ['ex-d', { name: 'Exercise D', equipment: 'barbell' }],
]);

const WORKOUT: ScheduledWorkoutDetailDto = {
  programSlug: 'prog-1',
  programName: 'Program 1',
  weekNumber: 1,
  order: 1,
  workout: {
    id: 'w1',
    name: 'Push A',
    slug: 'push-a',
    description: 'A workout.',
    estimatedDurationMinutes: 45,
    exercises: [],
  },
};

/** Builds the same view the session page builds, then renders the screen. */
async function renderScreen(session: WorkoutSessionDto): Promise<HTMLElement> {
  const cards = buildSessionExerciseCardViews({
    logs: session.exerciseLogs,
    targets: session.exerciseLogs.map(() => null),
    catalogByExerciseId: catalog,
    candidatesByPerformedExerciseId: new Map(),
    sessionStatus: 'in-progress',
  });
  const view: ActiveWorkoutView = {
    workout: WORKOUT,
    session,
    cards,
    progress: buildSessionProgress(session),
    addableExercises: [],
    screenState: 'in-progress',
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(ActiveWorkoutScreen, {
        view,
        programSlug: 'prog-1',
        weekNumber: 1,
        workoutOrder: 1,
      }),
    );
  });
  mounted.push({ container, root });
  return container;
}

/** The displayed exercise names in DOM order — full cards and compact rows. */
function cardNames(container: HTMLElement): string[] {
  const started = Array.from(container.querySelectorAll('article h2')).map(
    (heading) => heading.textContent ?? '',
  );
  const upcoming = Array.from(container.querySelectorAll('li[data-band="upcoming"]')).map(
    // The row title's innermost name span (the first nested span inside
    // the title wrapper).
    (row) => row.querySelector('span span')?.textContent ?? '',
  );
  return [...started, ...upcoming];
}

afterEach(() => {
  for (const { container, root } of mounted.splice(0)) {
    act(() => {
      root.unmount();
    });
    container.remove();
  }
});

describe('ActiveWorkoutScreen / canonical reorder consumption (M10 Slice 6)', () => {
  it('renders cards in the DTO array order — B, A, C — never sorted', async () => {
    // The flagship regression: a canonically reordered snapshot where B
    // (order 1) was moved above A (order 2), with C (order 3) last. The
    // exercise ids are deliberately non-alphabetical vs. their names, so
    // any sort by id or name would produce A, B, C and fail. B carries a
    // partial set count so every order circle stays a number (a done
    // occurrence's circle renders a check instead).
    const session: WorkoutSessionDto = {
      sessionId: 's-1',
      scheduledWorkoutId: 'sw-1',
      workoutId: 'w1',
      status: 'in-progress',
      startedAt: '2026-09-01T17:00:00.000Z',
      completedAt: null,
      version: 0,
      exerciseLogs: [
        log(1, 'ex-b', [repSet(1, 10, 50), repSet(2, 10, 50)]),
        log(2, 'ex-a', [repSet(1, 10, 40)]),
        log(3, 'ex-c', []),
      ],
      metrics: { totalSets: 3, totalReps: 30, totalDurationSeconds: 0, volume: 140 },
      prescribedSets: 9,
      skippedExerciseCount: 0,
    };

    const container = await renderScreen(session);

    expect(cardNames(container)).toEqual(['Exercise B', 'Exercise A', 'Exercise C']);
    // Order labels match the array position — cards and upcoming rows both
    // show their own `card.order` (=== index + 1 under the canonical DTO).
    const circles = Array.from(
      container.querySelectorAll(
        'article span[aria-hidden="true"], li[data-band="upcoming"] span[aria-hidden="true"]',
      ),
    ).map((circle) => circle.textContent ?? '');
    expect(circles).toEqual(['1', '2', '3']);
  });

  it('follows the reordered array for the active exercise — order 2 is active', async () => {
    // B (order 1) is fully logged, so the FIRST under-prescribed occurrence
    // in the reordered array — A (order 2) — must be the active card; the
    // untouched C (order 3) renders as a quiet "Up next" row.
    const session: WorkoutSessionDto = {
      sessionId: 's-1',
      scheduledWorkoutId: 'sw-1',
      workoutId: 'w1',
      status: 'in-progress',
      startedAt: '2026-09-01T17:00:00.000Z',
      completedAt: null,
      version: 0,
      exerciseLogs: [
        log(1, 'ex-b', [repSet(1, 10, 50), repSet(2, 10, 50), repSet(3, 10, 50)]),
        log(2, 'ex-a', [repSet(1, 10, 40)]),
        log(3, 'ex-c', []),
      ],
      metrics: { totalSets: 4, totalReps: 40, totalDurationSeconds: 0, volume: 190 },
      prescribedSets: 9,
      skippedExerciseCount: 0,
    };

    const container = await renderScreen(session);

    const names = cardNames(container);
    expect(names).toEqual(['Exercise B', 'Exercise A', 'Exercise C']);
    // The started cards render in the main list: B is done, A is active
    // and carries the open logger. C renders as the quiet upcoming row.
    const cards = Array.from(container.querySelectorAll('article'));
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain('Completed');
    expect(cards[0]?.textContent).not.toContain('In progress');
    expect(cards[1]?.textContent).toContain('In progress');
    const upcomingRow = container.querySelector('li[data-band="upcoming"]');
    expect(upcomingRow?.textContent).toContain('Exercise C');
    expect(upcomingRow?.textContent).toContain('3');
  });

  it('keeps skipped, logged-set and substituted state attached through the reorder', async () => {
    // B is skipped (its own muted card), A carries a logged set (partial),
    // C was substituted (performed id ≠ authored id, "Originally" line).
    const session: WorkoutSessionDto = {
      sessionId: 's-1',
      scheduledWorkoutId: 'sw-1',
      workoutId: 'w1',
      status: 'in-progress',
      startedAt: '2026-09-01T17:00:00.000Z',
      completedAt: null,
      version: 0,
      exerciseLogs: [
        log(1, 'ex-b', [], {
          isSkipped: true,
          substitutionEligibility: { blockedBy: 'skipped', canRestore: false },
          adjustmentEligibility: eligibility(true, false, true),
        }),
        log(2, 'ex-a', [repSet(1, 10, 40)], {
          adjustmentEligibility: eligibility(false, true, true, 'logged-sets'),
        }),
        log(3, 'ex-d-alt', [], {
          authoredExerciseId: 'ex-d',
          isSubstituted: true,
          substitutionEligibility: { blockedBy: null, canRestore: true },
        }),
      ],
      metrics: { totalSets: 1, totalReps: 10, totalDurationSeconds: 0, volume: 40 },
      prescribedSets: 6,
      skippedExerciseCount: 1,
    };

    const container = await renderScreen(session);

    const names = cardNames(container);
    expect(names).toEqual(['Exercise B', 'Exercise A', 'Exercise D Alt']);
    // The skipped card keeps its badge and hint attached to occurrence 1.
    const skipped = container.querySelectorAll('article')[0];
    expect(skipped?.textContent).toContain('Skipped');
    // The logged-set occurrence keeps its set row attached to occurrence 2.
    const partial = container.querySelectorAll('article')[1];
    expect(partial?.textContent).toContain('set row 40 kg × 10');
    // The substituted occurrence keeps performed identity + "Originally".
    const upcomingRow = container.querySelector('li[data-band="upcoming"]');
    expect(upcomingRow?.textContent).toContain('Exercise D Alt');
    expect(upcomingRow?.textContent).toContain('Originally: Exercise D');
  });

  it('passes the domain move flags to each occurrence panel — first and last only move inward', async () => {
    const session: WorkoutSessionDto = {
      sessionId: 's-1',
      scheduledWorkoutId: 'sw-1',
      workoutId: 'w1',
      status: 'in-progress',
      startedAt: '2026-09-01T17:00:00.000Z',
      completedAt: null,
      version: 0,
      exerciseLogs: [
        log(1, 'ex-b', []),
        log(2, 'ex-a', []),
        log(3, 'ex-c', []),
      ],
      metrics: { totalSets: 0, totalReps: 0, totalDurationSeconds: 0, volume: 0 },
      prescribedSets: 9,
      skippedExerciseCount: 0,
    };

    const container = await renderScreen(session);

    // The panel stub echoes the flags it received. First: no up, down yes.
    // Middle: both. Last: up yes, no down. The flags came from the DTO's
    // eligibility, keyed by each occurrence's own order.
    const text = container.textContent ?? '';
    expect(text).toContain('adjust 1 open up:no down:yes');
    expect(text).toContain('adjust 2 open up:yes down:yes');
    expect(text).toContain('adjust 3 open up:yes down:no');
  });
});

describe('ActiveWorkoutScreen / canonical render order with a skipped tail (PR #13 Finding 4)', () => {
  /** The order circles in true DOCUMENT order — cards and compact rows as the DOM emits them. */
  function documentOrderCircles(container: HTMLElement): string[] {
    return Array.from(
      container.querySelectorAll(
        'article span[aria-hidden="true"], li[data-band="upcoming"] span[aria-hidden="true"]',
      ),
    ).map((circle) => circle.textContent ?? '');
  }

  it('renders 1 active / 2 upcoming / 3 skipped visually as 1, 2, 3 — never 1, 3, 2', async () => {
    // The reported Codex case: order 1 is active, order 2 is still untouched,
    // order 3 is skipped. The old non-upcoming-first partition pulled the
    // skipped card ahead of the untouched one (DOM 1, 3, 2); the canonical
    // DTO order is 1, 2, 3 and that is what must render.
    const session: WorkoutSessionDto = {
      sessionId: 's-1',
      scheduledWorkoutId: 'sw-1',
      workoutId: 'w1',
      status: 'in-progress',
      startedAt: '2026-09-01T17:00:00.000Z',
      completedAt: null,
      version: 0,
      exerciseLogs: [
        log(1, 'ex-a', []),
        log(2, 'ex-b', []),
        log(3, 'ex-c', [], {
          isSkipped: true,
          substitutionEligibility: { blockedBy: 'skipped', canRestore: false },
          adjustmentEligibility: eligibility(true, true, false),
        }),
      ],
      metrics: { totalSets: 0, totalReps: 0, totalDurationSeconds: 0, volume: 0 },
      prescribedSets: 6,
      skippedExerciseCount: 1,
    };

    const container = await renderScreen(session);

    // Document order — the concatenation the user actually sees.
    expect(documentOrderCircles(container)).toEqual(['1', '2', '3']);

    // The skipped occurrence keeps its visibly-skipped rendering: the muted
    // skipped card (not a dimmed Up-next row), with its badge and hint.
    const articles = Array.from(container.querySelectorAll('article'));
    expect(articles).toHaveLength(3);
    const skippedCard = articles[2];
    expect(skippedCard?.textContent).toContain('Skipped');
    expect(skippedCard?.textContent).toContain(
      'Skipped in this session — it logged no sets and adds none to your progress.',
    );
    // No occurrence was pulled into the quiet band: the untouched occurrence
    // 2 renders as its own full card between the active and skipped ones.
    expect(container.querySelectorAll('li[data-band="upcoming"]')).toHaveLength(0);
    // Move controls still face the REAL adjacent neighbor: the skipped
    // occurrence at the visual tail may move up but not down.
    const text = container.textContent ?? '';
    expect(text).toContain('adjust 3 skipped up:yes down:no');
  });

  it('renders an interleaved partial occurrence behind an earlier untouched one canonically', async () => {
    // Not M10-specific: order 3 partial (a logged set) while order 2 is still
    // upcoming must also render 1, 2, 3 — the fix is kind-agnostic.
    const session: WorkoutSessionDto = {
      sessionId: 's-1',
      scheduledWorkoutId: 'sw-1',
      workoutId: 'w1',
      status: 'in-progress',
      startedAt: '2026-09-01T17:00:00.000Z',
      completedAt: null,
      version: 0,
      exerciseLogs: [
        log(1, 'ex-a', [repSet(1, 10, 50), repSet(2, 10, 50)]),
        log(2, 'ex-b', []),
        log(3, 'ex-c', [repSet(1, 10, 40)], {
          adjustmentEligibility: eligibility(false, true, false, 'logged-sets'),
        }),
      ],
      metrics: { totalSets: 4, totalReps: 40, totalDurationSeconds: 0, volume: 190 },
      prescribedSets: 9,
      skippedExerciseCount: 0,
    };

    const container = await renderScreen(session);

    expect(documentOrderCircles(container)).toEqual(['1', '2', '3']);
  });
});

