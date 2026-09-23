/**
 * @vitest-environment jsdom
 *
 * Presentation tests for M12 Slice 4: the historical Personal Record badge on
 * a completed session's set rows. Rendered with react-dom (React 19 act)
 * because the assertions are about rendered markup: the badge appears on the
 * exact set that established the record, nowhere else, and carries readable
 * text for screen readers.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { CompletedSessionDto } from '@/application/dto/completed-session';

vi.mock('@/features/history/services', () => ({
  getCompletedSessionUseCase: { execute: vi.fn() },
  getCompletedSessionRecordEventsUseCase: { execute: vi.fn() },
}));

import { toCompletedSessionView } from '@/features/history/completed-session-view';
import { CompletedSessionEntryList } from '@/features/history/components/CompletedSessionEntryList';

declare global {
  // React 19's act() environment flag; not part of the DOM lib typings.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { readonly container: HTMLElement; readonly root: Root }[] = [];

function entry(
  overrides: Partial<CompletedSessionDto['entries'][number]>,
): CompletedSessionDto['entries'][number] {
  return {
    authoredExerciseId: 'ex-001',
    performedExerciseId: 'ex-001',
    isSubstituted: false,
    isSkipped: false,
    source: 'template',
    exerciseOrder: 1,
    exerciseName: 'Goblet Squat',
    authoredExerciseName: 'Goblet Squat',
    exerciseSlug: 'goblet-squat',
    equipment: 'kettlebell',
    prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 },
    sets: [
      { type: 'reps', setNumber: 1, reps: 10, weightKg: 50, rpe: null },
      { type: 'reps', setNumber: 2, reps: 10, weightKg: 50, rpe: null },
      { type: 'reps', setNumber: 3, reps: 10, weightKg: 55, rpe: null },
    ],
    restSeconds: 90,
    ...overrides,
  };
}

function sessionDto(
  entries: ReadonlyArray<CompletedSessionDto['entries'][number]>,
): CompletedSessionDto {
  return {
    sessionId: 'session-1',
    workoutName: 'Full Body A',
    programName: 'Fit40 Beginner Strength',
    startedAt: '2026-01-01T10:00:00.000Z',
    completedAt: '2026-01-01T10:45:00.000Z',
    entries,
    metrics: { totalSets: 3, totalReps: 30, totalDurationSeconds: 0, volume: 1550 },
  };
}

async function renderSession(
  dto: CompletedSessionDto,
  recordEvents: Parameters<typeof toCompletedSessionView>[1] = [],
): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(CompletedSessionEntryList, {
        entries: toCompletedSessionView(dto, recordEvents).entries,
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

/** The set-row list items of the rendered list, in order. */
function setRows(container: HTMLElement): ReadonlyArray<HTMLElement> {
  return Array.from(container.querySelectorAll('ol ol > li'));
}

describe('CompletedSessionEntryList — historical personal records', () => {
  it('badges the exact set that established the record and not its equal sibling', async () => {
    const container = await renderSession(sessionDto([entry({})]), [
      { exerciseOrder: 1, setNumber: 1, metric: 'max-load', value: 50, previousBest: null },
      { exerciseOrder: 1, setNumber: 3, metric: 'max-load', value: 55, previousBest: 50 },
    ]);

    const rows = setRows(container);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('PR');
    expect(rows[1]?.textContent).not.toContain('PR');
    expect(rows[2]?.textContent).toContain('PR');
    // The set values keep rendering exactly as persisted.
    expect(rows[2]?.textContent).toContain('55 kg × 10');
  });

  it('exposes an understandable accessible phrase for the abbreviation', async () => {
    const container = await renderSession(sessionDto([entry({})]), [
      { exerciseOrder: 1, setNumber: 1, metric: 'max-load', value: 50, previousBest: null },
    ]);

    const row = setRows(container)[0];
    expect(row?.textContent).toContain('Personal record');
    expect(row?.querySelector('.sr-only')?.textContent).toBe('Personal record');
  });

  it('renders no indicator at all for a record-free session', async () => {
    const container = await renderSession(sessionDto([entry({})]), []);

    expect(container.textContent).not.toContain('PR');
    expect(setRows(container)).toHaveLength(3);
  });

  it('keeps duplicate occurrences distinct: only the flagged occurrence is badged', async () => {
    const entries = [
      entry({
        exerciseOrder: 1,
        sets: [{ type: 'reps', setNumber: 1, reps: 10, weightKg: 80, rpe: null }],
      }),
      entry({
        exerciseOrder: 2,
        sets: [{ type: 'reps', setNumber: 1, reps: 10, weightKg: 85, rpe: null }],
      }),
    ];

    const container = await renderSession(sessionDto(entries), [
      { exerciseOrder: 2, setNumber: 1, metric: 'max-load', value: 85, previousBest: 80 },
    ]);

    const rows = setRows(container);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).not.toContain('PR');
    expect(rows[1]?.textContent).toContain('PR');
  });

  it('renders a substituted occurrence with its indicator and its “Originally” context', async () => {
    const container = await renderSession(
      sessionDto([
        entry({
          authoredExerciseId: 'ex-001',
          performedExerciseId: 'ex-002',
          authoredExerciseName: 'Goblet Squat',
          exerciseName: 'Split Squat',
          isSubstituted: true,
          exerciseSlug: 'split-squat',
          sets: [{ type: 'reps', setNumber: 1, reps: 8, weightKg: 30, rpe: null }],
        }),
      ]),
      [{ exerciseOrder: 1, setNumber: 1, metric: 'max-load', value: 30, previousBest: null }],
    );

    expect(container.textContent).toContain('Split Squat');
    expect(container.textContent).toContain('Originally: Goblet Squat');
    expect(setRows(container)[0]?.textContent).toContain('PR');
  });

  it('renders a user-added occurrence with its provenance label and its indicator', async () => {
    const container = await renderSession(
      sessionDto([
        entry({
          authoredExerciseId: 'ex-009',
          performedExerciseId: 'ex-009',
          authoredExerciseName: 'Face Pull',
          exerciseName: 'Face Pull',
          exerciseSlug: 'face-pull',
          source: 'user_added',
          sets: [{ type: 'reps', setNumber: 1, reps: 15, weightKg: 20, rpe: null }],
        }),
      ]),
      [{ exerciseOrder: 1, setNumber: 1, metric: 'max-load', value: 20, previousBest: null }],
    );

    expect(container.textContent).toContain('Added during workout');
    expect(setRows(container)[0]?.textContent).toContain('PR');
  });

  it('leaves a skipped occurrence rendering exactly as before, with no indicator', async () => {
    const container = await renderSession(
      sessionDto([entry({ isSkipped: true, sets: [] })]),
      [{ exerciseOrder: 1, setNumber: 1, metric: 'max-load', value: 50, previousBest: null }],
    );

    expect(container.textContent).toContain('Skipped');
    expect(container.textContent).not.toContain('PR');
    expect(setRows(container)).toHaveLength(0);
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });
});
