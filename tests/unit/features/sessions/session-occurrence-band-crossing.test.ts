/**
 * @vitest-environment jsdom
 *
 * Regression test for the PR #13 P2 finding: "Preserve drafts when
 * occurrences cross render bands".
 *
 * The Active Workout screen renders every occurrence through ONE keyed
 * `SessionOccurrence` boundary in a single canonical-order list, so a reorder
 * that moves an occurrence between the full-card band and the compact
 * "Up next" band can no longer reparent (and remount) its subtree. This test
 * types a controlled draft into an occurrence's real `SetLoggerForm`, crosses
 * it over the band boundary, and asserts the draft follows the occurrence and
 * never leaks to its neighbor.
 *
 * Unlike `active-workout-screen.test.ts`, `SetLoggerForm` is NOT mocked here:
 * the draft/disclosure state under test lives in the real client island.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/features/sessions/components/ActiveWorkoutHeader', () => ({
  ActiveWorkoutHeader: () => createElement('header', null, 'session header'),
}));

vi.mock('@/features/sessions/components/SessionFinishBar', () => ({
  SessionFinishBar: () => createElement('div', null, 'finish bar'),
}));

vi.mock('@/features/sessions/components/SessionExerciseSwapPanel', () => ({
  SessionExerciseSwapPanel: () => createElement('div', null, 'swap panel'),
}));

vi.mock('@/features/sessions/components/SessionExerciseAdjustPanel', () => ({
  SessionExerciseAdjustPanel: (props: { readonly exerciseOrder: number }) =>
    createElement('div', null, `adjust ${props.exerciseOrder}`),
}));

vi.mock('@/features/sessions/actions/log-set', () => ({ logSetAction: vi.fn() }));
vi.mock('@/features/sessions/actions/update-set', () => ({ updateSetAction: vi.fn() }));
vi.mock('@/features/sessions/actions/delete-set', () => ({ deleteSetAction: vi.fn() }));
vi.mock('@/features/sessions/actions/substitute-exercise', () => ({
  substituteExerciseAction: vi.fn(),
}));
vi.mock('@/features/sessions/actions/restore-exercise', () => ({
  restoreExerciseAction: vi.fn(),
}));
vi.mock('@/features/sessions/actions/skip-exercise', () => ({ skipExerciseAction: vi.fn() }));
vi.mock('@/features/sessions/actions/unskip-exercise', () => ({ unskipExerciseAction: vi.fn() }));
vi.mock('@/features/sessions/actions/move-exercise', () => ({ moveExerciseAction: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
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

afterEach(() => {
  for (const { container, root } of mounted.splice(0)) {
    act(() => {
      root.unmount();
    });
    container.remove();
  }
});

const threeByEightToTen = { type: 'reps' as const, sets: 3, minReps: 8, maxReps: 10 };

/** In-progress occurrence whose move flags match its position in a 2-row session. */
function log(
  order: number,
  exerciseId: string,
  overrides: Partial<WorkoutSessionExerciseDto> = {},
): WorkoutSessionExerciseDto {
  return {
    authoredExerciseId: exerciseId,
    performedExerciseId: exerciseId,
    isSubstituted: false,
    isSkipped: false,
    occurrenceKey: order,
    source: 'template',
    substitutionEligibility: { blockedBy: null, canRestore: false },
    adjustmentEligibility: {
      isSkipped: false,
      blockedBy: null,
      canSkip: true,
      canUnskip: false,
      canMoveUp: order > 1,
      canMoveDown: order < 2,
    },
    order,
    prescription: threeByEightToTen,
    sets: [],
    ...overrides,
  };
}

const catalog = new Map<string, SessionExerciseCatalogMeta>([
  ['ex-a', { name: 'Squat', equipment: 'barbell' }],
  ['ex-b', { name: 'Bench', equipment: 'barbell' }],
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

/** Builds the real page view, then renders the screen into a rerenderable root. */
async function renderScreenRerenderable(session: WorkoutSessionDto): Promise<{
  readonly container: HTMLElement;
  readonly rerender: (session: WorkoutSessionDto) => Promise<void>;
}> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ container, root });

  async function renderInto(next: WorkoutSessionDto): Promise<void> {
    const cards = buildSessionExerciseCardViews({
      logs: next.exerciseLogs,
      targets: next.exerciseLogs.map(() => null),
      catalogByExerciseId: catalog,
      candidatesByPerformedExerciseId: new Map(),
      sessionStatus: 'in-progress',
    });
    const view: ActiveWorkoutView = {
      workout: WORKOUT,
      session: next,
      cards,
      progress: buildSessionProgress(next),
      screenState: 'in-progress',
    };
    await act(async () => {
      root.render(
        createElement(ActiveWorkoutScreen, {
          view,
          programSlug: 'prog-1',
          weekNumber: 1,
          workoutOrder: 1,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  await renderInto(session);
  return { container, rerender: renderInto };
}

function sessionWith(exerciseLogs: WorkoutSessionExerciseDto[]): WorkoutSessionDto {
  return {
    sessionId: 's-1',
    scheduledWorkoutId: 'sw-1',
    workoutId: 'w1',
    status: 'in-progress',
    startedAt: '2026-09-01T17:00:00.000Z',
    completedAt: null,
    version: 0,
    exerciseLogs,
    metrics: { totalSets: 0, totalReps: 0, totalDurationSeconds: 0, volume: 0 },
    prescribedSets: exerciseLogs.length * 3,
    skippedExerciseCount: 0,
  };
}

/** The visual band one occurrence is currently rendered in. */
function bandOf(container: HTMLElement, name: string): 'card' | 'upcoming' | 'none' {
  const upcomingRow = Array.from(
    container.querySelectorAll('li[data-band="upcoming"]'),
  ).find((row) => row.textContent?.includes(name));
  if (upcomingRow !== undefined) return 'upcoming';
  const article = Array.from(container.querySelectorAll('article')).find((card) =>
    card.textContent?.includes(name),
  );
  return article === undefined ? 'none' : 'card';
}

/** The `reps` input owned by the occurrence carrying `name` (card or row). */
function occurrenceRepsInput(container: HTMLElement, name: string): HTMLInputElement {
  const holders = [
    ...Array.from(container.querySelectorAll('article')),
    ...Array.from(container.querySelectorAll('li[data-band="upcoming"]')),
  ];
  const holder = holders.find((element) => element.textContent?.includes(name));
  if (holder === undefined) throw new Error(`missing occurrence ${name}`);
  const input = Array.from(holder.querySelectorAll('input')).find(
    (element) => (element as HTMLInputElement).name === 'reps',
  );
  if (input === undefined) throw new Error(`missing reps input for ${name}`);
  return input as HTMLInputElement;
}

/** The value of the occurrence's reps draft ('' when the field is absent). */
function occurrenceRepsValue(container: HTMLElement, name: string): string {
  const holders = [
    ...Array.from(container.querySelectorAll('article')),
    ...Array.from(container.querySelectorAll('li[data-band="upcoming"]')),
  ];
  const holder = holders.find((element) => element.textContent?.includes(name));
  const input = Array.from(holder?.querySelectorAll('input') ?? []).find(
    (element) => (element as HTMLInputElement).name === 'reps',
  ) as HTMLInputElement | undefined;
  return input?.value ?? '';
}

/** Whether the occurrence's "Up next" disclosure is expanded. */
function disclosureOpen(container: HTMLElement, name: string): boolean | null {
  const row = Array.from(container.querySelectorAll('li[data-band="upcoming"]')).find((element) =>
    element.textContent?.includes(name),
  );
  return row?.querySelector('details')?.open ?? null;
}

/** Types into a React controlled input the way a real browser does. */
async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  if (nativeSetter === undefined) throw new Error('missing native input value setter');
  await act(async () => {
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('ActiveWorkoutScreen / drafts cross the render bands (PR #13 P2)', () => {
  it('keeps occurrence A’s draft when a reorder moves A from the card band into the upcoming band', async () => {
    // The exact Codex scenario. A (Squat, occurrenceKey 1) starts at order 1 as
    // the active full card; B (Bench, occurrenceKey 2) is the quiet upcoming row.
    const squatLog = log(1, 'ex-a');
    const benchLog = log(2, 'ex-b');

    const { container, rerender } = await renderScreenRerenderable(
      sessionWith([squatLog, benchLog]),
    );

    // A is the full card; type a controlled draft into its logger.
    expect(bandOf(container, 'Squat')).toBe('card');
    await typeInto(occurrenceRepsInput(container, 'Squat'), '10');
    expect(occurrenceRepsValue(container, 'Squat')).toBe('10');

    // The server reorder: B moves above A. A becomes order 2 and — with the
    // active logger now B — crosses into the compact "Up next" band.
    await rerender(
      sessionWith([log(1, 'ex-b', { occurrenceKey: 2 }), log(2, 'ex-a', { occurrenceKey: 1 })]),
    );

    // A (Squat) crossed the band boundary as a compact row — same boundary,
    // so its disclosure stayed revealed and its draft followed it.
    expect(bandOf(container, 'Squat')).toBe('upcoming');
    expect(disclosureOpen(container, 'Squat')).toBe(true);
    expect(occurrenceRepsValue(container, 'Squat')).toBe('10');
    // B took the full-card slot and never inherited A's draft.
    expect(bandOf(container, 'Bench')).toBe('card');
    expect(occurrenceRepsValue(container, 'Bench')).toBe('');
  });

  it('carries the draft the other way when an upcoming row moves into the card band', async () => {
    // Start: B (Bench, occurrenceKey 2) is the active full card; A (Squat,
    // occurrenceKey 1) is the quiet upcoming row.
    const benchLog = log(1, 'ex-b', { occurrenceKey: 2 });
    const squatLog = log(2, 'ex-a', { occurrenceKey: 1 });

    const { container, rerender } = await renderScreenRerenderable(
      sessionWith([benchLog, squatLog]),
    );

    expect(bandOf(container, 'Squat')).toBe('upcoming');
    await typeInto(occurrenceRepsInput(container, 'Squat'), '8');
    expect(occurrenceRepsValue(container, 'Squat')).toBe('8');

    // A (Squat) moves above B and becomes the active full card.
    await rerender(
      sessionWith([
        { ...squatLog, order: 1, occurrenceKey: 1 },
        { ...benchLog, order: 2, occurrenceKey: 2 },
      ]),
    );

    expect(bandOf(container, 'Squat')).toBe('card');
    expect(occurrenceRepsValue(container, 'Squat')).toBe('8');
    // The neighbor that fell back into the upcoming band starts fresh.
    expect(bandOf(container, 'Bench')).toBe('upcoming');
    expect(occurrenceRepsValue(container, 'Bench')).toBe('');
  });
});

describe('ActiveWorkoutScreen / skip does not discard the occurrence draft (PR #13 corrective pass)', () => {
  /** Generic input lookup by `name` across the occurrence's card or row. */
  function occurrenceInput(
    container: HTMLElement,
    occurrenceName: string,
    inputName: string,
  ): HTMLInputElement | undefined {
    const holders = [
      ...Array.from(container.querySelectorAll('article')),
      ...Array.from(container.querySelectorAll('li[data-band="upcoming"]')),
    ];
    const holder = holders.find((element) => element.textContent?.includes(occurrenceName));
    return Array.from(holder?.querySelectorAll('input') ?? []).find(
      (element) => (element as HTMLInputElement).name === inputName,
    ) as HTMLInputElement | undefined;
  }

  it('keeps weight/reps/RPE through skip → rerender → unskip', async () => {
    // A (Squat, occurrenceKey 1) starts as the active full card with a
    // logger; B (Bench, occurrenceKey 2) is the untouched upcoming row.
    const { container, rerender } = await renderScreenRerenderable(
      sessionWith([log(1, 'ex-a'), log(2, 'ex-b')]),
    );

    const draft = { weight: '52.5', reps: '10', rpe: '7' };
    await typeInto(occurrenceInput(container, 'Squat', 'weightKg')!, draft.weight);
    await typeInto(occurrenceInput(container, 'Squat', 'reps')!, draft.reps);
    await typeInto(occurrenceInput(container, 'Squat', 'rpe')!, draft.rpe);
    expect(occurrenceInput(container, 'Squat', 'weightKg')?.value).toBe(draft.weight);
    expect(occurrenceInput(container, 'Squat', 'reps')?.value).toBe(draft.reps);
    expect(occurrenceInput(container, 'Squat', 'rpe')?.value).toBe(draft.rpe);

    // The user skips A. The skip clears the logged-set precondition is
    // irrelevant here — A has no sets — so the domain allows the decision;
    // the SERVER renders A skipped: no logger, muted card, no draft fields.
    await rerender(
      sessionWith([
        log(1, 'ex-a', {
          isSkipped: true,
          substitutionEligibility: { blockedBy: 'skipped', canRestore: false },
          adjustmentEligibility: {
            isSkipped: true,
            blockedBy: null,
            canSkip: false,
            canUnskip: true,
            canMoveUp: false,
            canMoveDown: true,
          },
        }),
        log(2, 'ex-b'),
      ]),
    );
    expect(occurrenceInput(container, 'Squat', 'weightKg')).toBeUndefined();
    expect(occurrenceInput(container, 'Squat', 'reps')).toBeUndefined();

    // …and unskips. The boundary kept the draft: the restored logger shows
    // the exact weight/reps/RPE the user had typed before the skip.
    await rerender(sessionWith([log(1, 'ex-a'), log(2, 'ex-b')]));
    expect(occurrenceInput(container, 'Squat', 'weightKg')?.value).toBe(draft.weight);
    expect(occurrenceInput(container, 'Squat', 'reps')?.value).toBe(draft.reps);
    expect(occurrenceInput(container, 'Squat', 'rpe')?.value).toBe(draft.rpe);
  });

  it('still resets the draft when the logger identity genuinely changes (a logged set)', async () => {
    // The intentional reset must survive: logging a set changes the resolved
    // logger instance (prefill flips to the session value), which is a
    // different logger identity — the boundary resets the draft then.
    const { container, rerender } = await renderScreenRerenderable(
      sessionWith([log(1, 'ex-a'), log(2, 'ex-b')]),
    );
    await typeInto(occurrenceInput(container, 'Squat', 'weightKg')!, '52.5');
    expect(occurrenceInput(container, 'Squat', 'weightKg')?.value).toBe('52.5');

    // A set is logged elsewhere in the session (B) — A's snapshot changes
    // version but A's own logger identity does not, so A's draft survives.
    await rerender(
      sessionWith([
        log(1, 'ex-a'),
        {
          ...log(2, 'ex-b'),
          sets: [{ setNumber: 1, type: 'reps' as const, reps: 8, weightKg: 60, rpe: null }],
        },
      ]),
    );
    expect(occurrenceInput(container, 'Squat', 'weightKg')?.value).toBe('52.5');
  });
});

describe('ActiveWorkoutScreen / a completed occurrence retracts its logger disclosure (PR #13 P2)', () => {
  /** One logged reps set, exactly as the server returns it after the mutation. */
  function loggedSet(setNumber: number): WorkoutSessionSetDto {
    return { setNumber, type: 'reps', reps: 10, weightKg: 50, rpe: 7 };
  }

  /** The logger disclosure of the occurrence carrying `name` (card or row). */
  function loggerDetails(
    container: HTMLElement,
    name: string,
  ): HTMLDetailsElement | undefined {
    const holders = [
      ...Array.from(container.querySelectorAll('article')),
      ...Array.from(container.querySelectorAll('li[data-band="upcoming"]')),
    ];
    const holder = holders.find((element) => element.textContent?.includes(name));
    return holder?.querySelector('details') ?? undefined;
  }

  it('closes the finished occurrence’s logger while the next active one stays available', async () => {
    // A (Squat, occurrenceKey 1) starts ACTIVE: its logger form renders
    // directly, without a disclosure to open. B (Bench, occurrenceKey 2) is
    // the untouched upcoming row.
    const { container, rerender } = await renderScreenRerenderable(
      sessionWith([log(1, 'ex-a'), log(2, 'ex-b')]),
    );
    expect(bandOf(container, 'Squat')).toBe('card');
    expect(loggerDetails(container, 'Squat')).toBeUndefined();
    await typeInto(occurrenceRepsInput(container, 'Squat'), '10');
    expect(occurrenceRepsValue(container, 'Squat')).toBe('10');

    // The FINAL prescribed set lands: A becomes `done` (3/3 sets) and B
    // becomes the first non-skipped, incomplete occurrence — the active
    // logger target.
    await rerender(
      sessionWith([
        { ...log(1, 'ex-a'), sets: [loggedSet(1), loggedSet(2), loggedSet(3)] },
        log(2, 'ex-b'),
      ]),
    );

    // A crossed active → done. The completion transition retracts the
    // disclosure inherited from its active past, so the finished occurrence
    // does not keep an expanded logging form.
    const doneDetails = loggerDetails(container, 'Squat');
    expect(doneDetails).toBeDefined();
    expect(doneDetails?.open).toBe(false);

    // The next active occurrence still exposes its logger for logging.
    expect(bandOf(container, 'Bench')).toBe('card');
    expect(loggerDetails(container, 'Bench')).toBeUndefined();
    expect(occurrenceRepsInput(container, 'Bench')).toBeDefined();
  });

  it('keeps a `done` occurrence closed through an ordinary rerender (kind unchanged)', async () => {
    const doneSession = sessionWith([
      { ...log(1, 'ex-a'), sets: [loggedSet(1), loggedSet(2), loggedSet(3)] },
      log(2, 'ex-b'),
    ]);
    const { container, rerender } = await renderScreenRerenderable(doneSession);

    // Mounts already `done` — never active — so it never reveals a logger.
    expect(loggerDetails(container, 'Squat')?.open).toBe(false);

    // An ordinary rerender (fresh object identities, identical kind) must not
    // toggle the disclosure in either direction.
    await rerender({ ...doneSession, exerciseLogs: [...doneSession.exerciseLogs] });
    expect(loggerDetails(container, 'Squat')?.open).toBe(false);
    expect(bandOf(container, 'Bench')).toBe('card');
  });
});
