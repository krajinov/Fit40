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
