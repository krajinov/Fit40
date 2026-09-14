/**
 * @vitest-environment jsdom
 *
 * Presentation tests for the M10 skip rendering on the exercise card: a
 * skipped occurrence shows the neutral badge, the muted hint, an Undo-skip
 * control — and NO logger, no "Log set" affordance, no swap panel. Rendered
 * with react-dom (React 19 act) because the assertions are about rendered
 * markup; the client islands are mocked at their action boundaries, same
 * pattern as `upcoming-exercise-list.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/features/sessions/actions/log-set', () => ({ logSetAction: vi.fn() }));
vi.mock('@/features/sessions/actions/update-set', () => ({ updateSetAction: vi.fn() }));
vi.mock('@/features/sessions/actions/delete-set', () => ({ deleteSetAction: vi.fn() }));
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
import type {
  SessionExerciseCardView,
  SessionProgressView,
} from '@/features/sessions/active-workout-views';
import type { SessionLoggerView } from '@/features/sessions/active-workout-logger-views';
import type { SessionSubstitutionView } from '@/features/sessions/session-substitution-views';
import { SKIPPED_HINT_LABEL } from '@/features/sessions/session-adjustment-views';
import { SessionExerciseCard } from '@/features/sessions/components/SessionExerciseCard';
import { SessionProgressCard } from '@/features/sessions/components/SessionProgressCard';

declare global {
  // React 19's act() environment flag; not part of the DOM lib typings.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { readonly container: HTMLElement; readonly root: Root }[] = [];

const logger: SessionLoggerView = {
  prefillWeightKg: null,
  prefillSeconds: null,
  prefillSource: 'none',
  prefillKind: 'weight',
  callout: null,
  quietLabel: null,
  hintLabel: null,
};

const hiddenSubstitution: SessionSubstitutionView = {
  state: 'hidden',
  canRestore: false,
  candidates: [],
  candidatesLimited: false,
  blockedLabel: null,
};

const noCandidatesSubstitution: SessionSubstitutionView = {
  state: 'no-candidates',
  canRestore: false,
  candidates: [],
  candidatesLimited: false,
  blockedLabel: null,
};

function sessionLog(order: number, isSkipped = false): WorkoutSessionExerciseDto {
  return {
    authoredExerciseId: 'ex-bench',
    performedExerciseId: 'ex-bench',
    isSubstituted: false,
    isSkipped,
    // Defaults to the order (the fixture's implicit occurrenceKey).
    occurrenceKey: order,
    substitutionEligibility: { blockedBy: isSkipped ? 'skipped' : null, canRestore: false },
    adjustmentEligibility: isSkipped
      ? {
          isSkipped: true,
          blockedBy: null,
          canSkip: false,
          canUnskip: true,
          canMoveUp: true,
          canMoveDown: true,
        }
      : {
          isSkipped: false,
          blockedBy: null,
          canSkip: true,
          canUnskip: false,
          canMoveUp: true,
          canMoveDown: true,
        },
    order,
    prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 },
    sets: [],
  };
}

function cardView(overrides: Partial<SessionExerciseCardView> = {}): SessionExerciseCardView {
  return {
    order: 1,
    renderKey: '1:ex-001:ex-001',
    kind: 'upcoming',
    name: 'Bench Press',
    originallyName: null,
    equipmentLabel: 'Barbell',
    prescriptionLabel: '3 × 8–10',
    badge: { style: 'neutral', label: 'Upcoming', mobileVisible: false },
    setRows: [],
    logger,
    substitution: noCandidatesSubstitution,
    adjustment: { state: 'open', blockedLabel: null, canMoveUp: true, canMoveDown: true },
    ...overrides,
  };
}

function skippedCardView(): SessionExerciseCardView {
  return cardView({
    kind: 'skipped',
    badge: { style: 'neutral', label: 'Skipped', mobileVisible: true },
    logger: null,
    substitution: hiddenSubstitution,
    adjustment: { state: 'skipped', blockedLabel: null, canMoveUp: true, canMoveDown: true },
  });
}

const BASE_PROPS = {
  sessionId: 's-1',
  expectedSessionVersion: 0,
  programSlug: 'prog-1',
  weekNumber: 1,
  workoutOrder: 1,
} as const;

async function renderCard(
  card: SessionExerciseCardView,
  log: WorkoutSessionExerciseDto,
  readOnly = false,
): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(SessionExerciseCard, {
        card,
        log,
        readOnly,
        ...BASE_PROPS,
      }),
    );
  });
  mounted.push({ container, root });
  return container;
}

function progressView(overrides: Partial<SessionProgressView> = {}): SessionProgressView {
  return {
    loggedSets: 2,
    prescribedSets: 6,
    skippedCount: 0,
    percentage: 33,
    repsLabel: '20 reps',
    volumeLabel: '1,000 kg',
    ...overrides,
  };
}

async function renderProgress(progress: SessionProgressView): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(SessionProgressCard, { progress }));
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

describe('SessionExerciseCard / skipped rendering (M10)', () => {
  it('shows the Skipped badge and the muted hint, and keeps the identity lines', async () => {
    const container = await renderCard(skippedCardView(), sessionLog(1, true));

    expect(container.textContent).toContain('Skipped');
    expect(container.textContent).toContain(SKIPPED_HINT_LABEL);
    expect(container.textContent).toContain('Bench Press');
    expect(container.textContent).toContain('3 × 8–10');
    expect(container.textContent).toContain('Barbell');
  });

  it('renders no logger, no "Log set" affordance and no swap panel on a skipped card', async () => {
    const container = await renderCard(skippedCardView(), sessionLog(1, true));

    expect(container.textContent).not.toContain('Log set');
    expect(container.textContent).not.toContain('Swap exercise');
    expect(container.textContent).not.toContain('Restore original exercise');
    // The only forms on a skipped card are the adjustment controls —
    // Undo skip and the two move controls (a skipped occurrence may still
    // move, M10 Slice 6) — no set-logger form exists.
    const forms = Array.from(container.querySelectorAll('form'));
    expect(forms).toHaveLength(3);
    expect(forms[0]?.textContent).toContain('Undo skip');
    expect(forms[1]?.textContent).toContain('Move up');
    expect(forms[2]?.textContent).toContain('Move down');
  });

  it('renders the Undo-skip control on a skipped card while mutable', async () => {
    const container = await renderCard(skippedCardView(), sessionLog(1, true));

    expect(container.textContent).toContain('Undo skip');
  });

  it('renders no undo control on a completed session (frozen decision)', async () => {
    const container = await renderCard(
      cardView({
        kind: 'skipped',
        badge: { style: 'neutral', label: 'Skipped', mobileVisible: true },
        logger: null,
        substitution: hiddenSubstitution,
        // The domain freezes the completed session: hidden, no control.
        adjustment: { state: 'hidden', blockedLabel: null, canMoveUp: false, canMoveDown: false },
      }),
      sessionLog(1, true),
      true,
    );

    expect(container.textContent).toContain('Skipped');
    expect(container.textContent).not.toContain('Undo skip');
    expect(container.textContent).not.toContain('Skip exercise');
  });

  it('renders the blocked copy and no control when logged sets block the skip', async () => {
    const container = await renderCard(
      cardView({
        kind: 'partial',
        badge: { style: 'neutral', label: '1 of 3 sets', mobileVisible: true },
        logger,
        substitution: noCandidatesSubstitution,
        adjustment: { state: 'blocked-logged-sets', blockedLabel: 'Delete your logged sets to skip this exercise.', canMoveUp: true, canMoveDown: true },
      }),
      sessionLog(1, false),
    );

    expect(container.textContent).toContain('Delete your logged sets to skip this exercise.');
    expect(container.textContent).not.toContain('Skip exercise');
    expect(container.textContent).not.toContain('Undo skip');
  });

  it('renders the Skip control on an open occurrence (read-write card)', async () => {
    const container = await renderCard(cardView(), sessionLog(1, false));

    expect(container.textContent).toContain('Skip exercise');
  });
});

describe('SessionExerciseCard / adjacent move rendering (M10 Slice 6)', () => {
  it('renders both move controls on a mid-list open card', async () => {
    const container = await renderCard(cardView(), sessionLog(1, false));

    expect(container.textContent).toContain('Move up');
    expect(container.textContent).toContain('Move down');
  });

  it('renders only Move down when the view mapper says there is no neighbor above', async () => {
    const container = await renderCard(
      cardView({
        adjustment: { state: 'open', blockedLabel: null, canMoveUp: false, canMoveDown: true },
      }),
      sessionLog(1, false),
    );

    expect(container.textContent).not.toContain('Move up');
    expect(container.textContent).toContain('Move down');
  });

  it('renders only Move up when the view mapper says there is no neighbor below', async () => {
    const container = await renderCard(
      cardView({
        adjustment: { state: 'open', blockedLabel: null, canMoveUp: true, canMoveDown: false },
      }),
      sessionLog(1, false),
    );

    expect(container.textContent).toContain('Move up');
    expect(container.textContent).not.toContain('Move down');
  });

  it('renders no move controls for a single-occurrence card', async () => {
    const container = await renderCard(
      cardView({
        adjustment: { state: 'open', blockedLabel: null, canMoveUp: false, canMoveDown: false },
      }),
      sessionLog(1, false),
    );

    expect(container.textContent).toContain('Skip exercise');
    expect(container.textContent).not.toContain('Move up');
    expect(container.textContent).not.toContain('Move down');
  });

  it('keeps move controls on a skipped card — only the skip decision is tied to it', async () => {
    const container = await renderCard(skippedCardView(), sessionLog(1, true));

    expect(container.textContent).toContain('Undo skip');
    expect(container.textContent).toContain('Move up');
    expect(container.textContent).toContain('Move down');
  });

  it('keeps move controls on a logged-set-blocked card while showing the blocked copy', async () => {
    // Logged sets block the SKIP decision only — never a reorder.
    const container = await renderCard(
      cardView({
        kind: 'partial',
        badge: { style: 'neutral', label: '1 of 3 sets', mobileVisible: true },
        logger,
        substitution: noCandidatesSubstitution,
        adjustment: { state: 'blocked-logged-sets', blockedLabel: 'Delete your logged sets to skip this exercise.', canMoveUp: true, canMoveDown: false },
      }),
      sessionLog(1, false),
    );

    expect(container.textContent).toContain('Delete your logged sets to skip this exercise.');
    expect(container.textContent).toContain('Move up');
    expect(container.textContent).not.toContain('Move down');
  });

  it('renders no move controls on a completed (read-only) card', async () => {
    const container = await renderCard(
      cardView({
        kind: 'done',
        badge: { style: 'done', label: 'Completed', mobileVisible: true },
        logger: null,
        substitution: hiddenSubstitution,
        adjustment: { state: 'hidden', blockedLabel: null, canMoveUp: false, canMoveDown: false },
      }),
      sessionLog(1, false),
      true,
    );

    expect(container.textContent).not.toContain('Move up');
    expect(container.textContent).not.toContain('Move down');
    expect(container.textContent).not.toContain('Skip exercise');
  });

  it('substituted occurrences move normally and keep their identity lines', async () => {
    const container = await renderCard(
      cardView({
        name: 'Dumbbell Bench Press',
        originallyName: 'Bench Press',
      }),
      sessionLog(1, false),
    );

    expect(container.textContent).toContain('Move up');
    expect(container.textContent).toContain('Move down');
    expect(container.textContent).toContain('Dumbbell Bench Press');
    expect(container.textContent).toContain('Originally: Bench Press');
  });
});

describe('SessionProgressCard / skipped count suffix (M10)', () => {
  it('appends the muted "· N skipped" suffix only when the count is positive', async () => {
    const withSkipped = await renderProgress(progressView({ skippedCount: 2 }));
    const withoutSkipped = await renderProgress(progressView({ skippedCount: 0 }));

    expect(withSkipped.textContent).toContain('2 of 6 sets logged · 2 skipped');
    expect(withoutSkipped.textContent).toContain('2 of 6 sets logged');
    expect(withoutSkipped.textContent).not.toContain('skipped');
  });
});

