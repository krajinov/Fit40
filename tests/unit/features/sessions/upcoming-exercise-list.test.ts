/**
 * @vitest-environment jsdom
 *
 * Presentation tests for the "Up next" band's substitution context (M9
 * review fix): a substituted upcoming occurrence shows the performed exercise
 * as the primary title with the same subtle "Originally: …" context used on
 * the exercise cards and in history. Rendered with react-dom (React 19 act)
 * because the assertions are about the rendered title markup — a pure
 * function test cannot cover it. The set-logger and swap-panel client
 * islands are mocked away; the row contract under test is purely rendered
 * output.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/features/sessions/actions/log-set', () => ({ logSetAction: vi.fn() }));
vi.mock('@/features/sessions/actions/substitute-exercise', () => ({
  substituteExerciseAction: vi.fn(),
}));
vi.mock('@/features/sessions/actions/restore-exercise', () => ({
  restoreExerciseAction: vi.fn(),
}));
vi.mock('@/features/sessions/actions/skip-exercise', () => ({
  skipExerciseAction: vi.fn(),
}));
vi.mock('@/features/sessions/actions/unskip-exercise', () => ({
  unskipExerciseAction: vi.fn(),
}));
vi.mock('@/features/sessions/actions/move-exercise', () => ({
  moveExerciseAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import type { WorkoutSessionExerciseDto } from '@/application/dto/workout-session';
import type { SessionExerciseCardView } from '@/features/sessions/active-workout-views';
import type { SessionLoggerView } from '@/features/sessions/active-workout-logger-views';
import type {
  SessionSubstitutionCandidateView,
  SessionSubstitutionView,
} from '@/features/sessions/session-substitution-views';
import type { SessionAdjustmentView } from '@/features/sessions/session-adjustment-views';
import { UpcomingExerciseList } from '@/features/sessions/components/UpcomingExerciseList';

declare global {
  // React 19's act() environment flag; not part of the DOM lib typings.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { readonly container: HTMLElement; readonly root: Root }[] = [];

async function renderList(
  upcoming: ReadonlyArray<SessionExerciseCardView>,
  logs: ReadonlyMap<number, WorkoutSessionExerciseDto>,
): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(UpcomingExerciseList, {
        upcoming,
        logs,
        sessionId: 's-1',
        expectedSessionVersion: 0,
        programSlug: 'prog-1',
        weekNumber: 1,
        workoutOrder: 1,
      }),
    );
  });
  mounted.push({ container, root });
  return container;
}

afterEach(() => {
  for (const { container, root } of mounted.splice(0)) {
    act(() => {
      root.unmount();
    });
    container.remove();
  }
});
const prescription = { type: 'reps' as const, sets: 3, minReps: 8, maxReps: 10 };

const logger: SessionLoggerView = {
  prefillWeightKg: null,
  prefillSeconds: null,
  prefillSource: 'none',
  prefillKind: 'weight',
  callout: null,
  quietLabel: null,
  hintLabel: null,
};

const mutableSubstitution: SessionSubstitutionView = {
  state: 'restore-available',
  canRestore: true,
  candidates: [] as ReadonlyArray<SessionSubstitutionCandidateView>,
  candidatesLimited: false,
  blockedLabel: null,
};

const openAdjustment: SessionAdjustmentView = {
  state: 'open',
  blockedLabel: null,
  canMoveUp: true,
  canMoveDown: true,
};

function upcomingCard(overrides: Partial<SessionExerciseCardView> = {}): SessionExerciseCardView {
  return {
    order: 2,
    renderKey: '2:ex-001:ex-001',
    kind: 'upcoming',
    name: 'Dumbbell Bench Press',
    originallyName: null,
    equipmentLabel: 'Dumbbell',
    prescriptionLabel: '3 × 8–10',
    badge: { style: 'neutral', label: 'Upcoming', mobileVisible: false },
    setRows: [],
    logger,
    substitution: mutableSubstitution,
    adjustment: openAdjustment,
    ...overrides,
  };
}

function sessionLog(order: number): WorkoutSessionExerciseDto {
  return {
    authoredExerciseId: 'ex-bench',
    performedExerciseId: 'ex-db-bench',
    isSubstituted: true,
    isSkipped: false,
    substitutionEligibility: { blockedBy: null, canRestore: true },
    adjustmentEligibility: {
      isSkipped: false,
      blockedBy: null,
      canSkip: true,
      canUnskip: false,
      canMoveUp: true,
      canMoveDown: true,
    },
    order,
    prescription,
    sets: [],
  };
}

function summaryTitle(container: HTMLElement): string {
  const summary = container.querySelector('summary');
  if (summary === null) throw new Error('missing summary');
  return summary.textContent ?? '';
}

function rowByName(container: HTMLElement, name: string): HTMLElement | null {
  return (
    Array.from(container.querySelectorAll('li')).find((li) => li.textContent?.includes(name)) ?? null
  );
}

describe('UpcomingExerciseList / substituted occurrence context (M9)', () => {
  it('shows the performed exercise as the primary title with the "Originally" context', async () => {
    const card = upcomingCard({ originallyName: 'Bench Press' });
    const container = await renderList([card], new Map([[card.order, sessionLog(card.order)]]));

    const summary = summaryTitle(container);
    expect(summary).toContain('Dumbbell Bench Press');
    expect(summary).toContain('Originally: Bench Press');
    // The performed exercise stays the primary title; the context line
    // never replaces it.
    expect(summary.indexOf('Dumbbell Bench Press')).toBeLessThan(
      summary.indexOf('Originally: Bench Press'),
    );
  });

  it('omits the context line for an unsubstituted upcoming occurrence', async () => {
    const card = upcomingCard({ order: 3, name: 'Row', originallyName: null });
    const container = await renderList([card], new Map([[card.order, sessionLog(card.order)]]));

    expect(container.textContent).toContain('Row');
    expect(container.textContent).not.toContain('Originally');
  });

  it('renders the context on the plain (no-logger) upcoming row too', async () => {
    // A completed screen yields no logger: the plain row branch must show
    // the same substitution context.
    const card = upcomingCard({
      order: 4,
      originallyName: 'Bench Press',
      logger: null,
      substitution: { ...mutableSubstitution, state: 'hidden', canRestore: false },
    });
    const container = await renderList([card], new Map([[card.order, sessionLog(card.order)]]));

    const row = rowByName(container, 'Dumbbell Bench Press');
    expect(row?.textContent).toContain('Dumbbell Bench Press');
    expect(row?.textContent).toContain('Originally: Bench Press');
  });
});

describe('UpcomingExerciseList / adjacent move affordance (M10 Slice 6)', () => {
  it('renders the shared move controls inside the upcoming expand, consistent with the main card', async () => {
    // One shared adjustment affordance: upcoming rows consume the same
    // panel the main card uses — no separate movement rule for them.
    const card = upcomingCard();
    const container = await renderList([card], new Map([[card.order, sessionLog(card.order)]]));

    const row = rowByName(container, 'Dumbbell Bench Press');
    expect(row?.textContent).toContain('Skip exercise');
    expect(row?.textContent).toContain('Move up');
    expect(row?.textContent).toContain('Move down');
  });

  it('renders no move controls when the domain says the occurrence cannot move', async () => {
    const card = upcomingCard({
      adjustment: { state: 'open', blockedLabel: null, canMoveUp: false, canMoveDown: false },
    });
    const container = await renderList([card], new Map([[card.order, sessionLog(card.order)]]));

    const row = rowByName(container, 'Dumbbell Bench Press');
    expect(row?.textContent).toContain('Skip exercise');
    expect(row?.textContent).not.toContain('Move up');
    expect(row?.textContent).not.toContain('Move down');
  });

  it('renders the blocked copy with move controls when logged sets block the skip', async () => {
    const card = upcomingCard({
      kind: 'partial',
      adjustment: {
        state: 'blocked-logged-sets',
        blockedLabel: 'Delete your logged sets to skip this exercise.',
        canMoveUp: true,
        canMoveDown: true,
      },
    });
    const container = await renderList([card], new Map([[card.order, sessionLog(card.order)]]));

    const row = rowByName(container, 'Dumbbell Bench Press');
    expect(row?.textContent).toContain('Delete your logged sets to skip this exercise.');
    expect(row?.textContent).not.toContain('Skip exercise');
    expect(row?.textContent).toContain('Move up');
    expect(row?.textContent).toContain('Move down');
  });

  it('renders no adjustment controls at all for a hidden occurrence', async () => {
    const card = upcomingCard({
      adjustment: { state: 'hidden', blockedLabel: null, canMoveUp: false, canMoveDown: false },
    });
    const container = await renderList([card], new Map([[card.order, sessionLog(card.order)]]));

    const row = rowByName(container, 'Dumbbell Bench Press');
    expect(row?.textContent).not.toContain('Skip exercise');
    expect(row?.textContent).not.toContain('Undo skip');
    expect(row?.textContent).not.toContain('Move up');
    expect(row?.textContent).not.toContain('Move down');
  });
});

// ─── PR #13 Finding 2: React state must not follow mutable order keys ────────

/**
 * A render-and-rerender harness: unlike `renderList`, this returns a
 * `rerender` function so the test can simulate the canonical reorder
 * arriving as a new server render (B moved above A) and assert what happened
 * to local component state at each order slot.
 */
async function renderListRerenderable(
  initial: ReadonlyArray<SessionExerciseCardView>,
  initialLogs: ReadonlyMap<number, WorkoutSessionExerciseDto>,
): Promise<{
  container: HTMLElement;
  rerender: (
    upcoming: ReadonlyArray<SessionExerciseCardView>,
    logs: ReadonlyMap<number, WorkoutSessionExerciseDto>,
  ) => Promise<void>;
}> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ container, root });

  async function renderInto(
    upcoming: ReadonlyArray<SessionExerciseCardView>,
    logs: ReadonlyMap<number, WorkoutSessionExerciseDto>,
  ): Promise<void> {
    await act(async () => {
      root.render(
        createElement(UpcomingExerciseList, {
          upcoming,
          logs,
          sessionId: 's-1',
          expectedSessionVersion: 0,
          programSlug: 'prog-1',
          weekNumber: 1,
          workoutOrder: 1,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  await renderInto(initial, initialLogs);
  return { container, rerender: renderInto };
}

/** The reps input of the FIRST row's expanded logger. */
function firstRowCountInput(container: HTMLElement): HTMLInputElement {
  const firstLi = container.querySelector('li');
  if (firstLi === null) throw new Error('missing first row');
  const input = Array.from(firstLi.querySelectorAll('input')).find(
    (el) => (el as HTMLInputElement).name === 'reps',
  );
  if (input === undefined) throw new Error('missing reps input in the first row');
  return input as HTMLInputElement;
}

/** Types into a React controlled input the way a real browser does (jsdom needs the native value setter to reach React's onChange). */
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

describe('UpcomingExerciseList / reorder remounts the occurrence subtree (PR #13 Finding 2)', () => {
  it("a reorder that seats a different occurrence at order 1 does not inherit the previous occupant's local state", async () => {
    // Rendered state: A (Squat, order 1) and B (Bench, order 2) — distinct
    // exercises at distinct orders. Both rows carry a logger (expandable).
    const squatCard = upcomingCard({ order: 1, renderKey: '1:ex-squat:ex-squat', name: 'Squat' });
    const benchCard = upcomingCard({ order: 2, renderKey: '2:ex-bench:ex-bench', name: 'Bench' });
    const squatLog: WorkoutSessionExerciseDto = {
      ...sessionLog(1),
      authoredExerciseId: 'ex-squat',
      performedExerciseId: 'ex-squat',
    };
    const benchLog: WorkoutSessionExerciseDto = {
      ...sessionLog(2),
      authoredExerciseId: 'ex-bench',
      performedExerciseId: 'ex-bench',
    };

    const { container, rerender } = await renderListRerenderable(
      [squatCard, benchCard],
      new Map([
        [1, squatLog],
        [2, benchLog],
      ]),
    );

    // The user types into A's (Squat's) controlled logger — LOCAL
    // SetLoggerForm state at the order-1 slot.
    const squatInput = firstRowCountInput(container);
    await typeInto(squatInput, '10');
    expect(squatInput.value).toBe('10');

    // The canonical reorder arrives from the server: B (Bench) now occupies
    // order 1; A (Squat) moved to order 2. The renderKey changes at the
    // order-1 slot, so React REMOUNTS that subtree — Bench never inherits
    // the squat draft.
    const reorderedBench = upcomingCard({
      order: 1,
      renderKey: '1:ex-bench:ex-bench',
      name: 'Bench',
    });
    const reorderedSquat = upcomingCard({
      order: 2,
      renderKey: '2:ex-squat:ex-squat',
      name: 'Squat',
    });
    await rerender(
      [reorderedBench, reorderedSquat],
      new Map([
        [1, benchLog],
        [2, squatLog],
      ]),
    );

    // The order-1 row is now Bench, and its logger state started fresh:
    // the squat draft (10) is gone — it did not follow the numeric key.
    const benchInput = firstRowCountInput(container);
    expect(container.querySelector('li')?.textContent).toContain('Bench');
    expect(benchInput.value).toBe('');
    // The Squat occurrence (now order 2) renders as its own fresh row.
    expect(container.textContent).toContain('Squat');
  });

  it('an ordinary rerender of the same occurrence keeps its local state', async () => {
    const squatCard = upcomingCard({ order: 1, renderKey: '1:ex-squat:ex-squat', name: 'Squat' });
    const squatLog: WorkoutSessionExerciseDto = {
      ...sessionLog(1),
      authoredExerciseId: 'ex-squat',
      performedExerciseId: 'ex-squat',
    };
    const { container, rerender } = await renderListRerenderable(
      [squatCard],
      new Map([[1, squatLog]]),
    );

    const input = firstRowCountInput(container);
    await typeInto(input, '8');

    // Same occurrence, same order, same identity — the key is stable, so an
    // unrelated rerender (e.g. a target refresh) preserves the draft.
    await rerender([squatCard], new Map([[1, squatLog]]));

    const inputAfter = firstRowCountInput(container);
    expect(inputAfter.value).toBe('8');
  });
});
