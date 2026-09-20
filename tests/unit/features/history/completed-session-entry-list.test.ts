/**
 * @vitest-environment jsdom
 *
 * Presentation tests for M10 Slice 7: skipped occurrences in completed
 * history. Rendered with react-dom (React 19 act) because the assertions are
 * about rendered markup. The view model is exercised for real (the pure
 * mapper produces the views) so the skip → no-link / badge rules are proven
 * end to end from DTO to DOM.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The view module transitively imports the feature composition root (DB
// wiring). These tests exercise only the pure mapper + component, so the
// root is stubbed per the dashboard-view precedent.
vi.mock('@/features/history/services', () => ({
  getCompletedSessionUseCase: vi.fn(),
}));

// Hermetic unit boundary: the view module runtime-imports the history DI
// barrel (db client + env); unit tests mock it like the existing view tests.
vi.mock('@/features/history/services', () => ({
  getCompletedSessionUseCase: { execute: vi.fn() },
}));

vi.mock('@/features/history/services', () => ({
  getCompletedSessionUseCase: { execute: vi.fn() },
}));

import type { CompletedSessionDto } from '@/application/dto/completed-session';
import { toCompletedSessionView } from '@/features/history/completed-session-view';
import { CompletedSessionEntryList } from '@/features/history/components/CompletedSessionEntryList';

// React 19 requires an explicit opt-in for act() outside react-dom/test-utils.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function entry(
  overrides: Partial<CompletedSessionDto['entries'][number]>,
): CompletedSessionDto['entries'][number] {
  return {
    authoredExerciseId: 'ex-001',
    performedExerciseId: 'ex-001',
    isSubstituted: false,
    isSkipped: false,
    exerciseOrder: 1,
    exerciseName: 'Goblet Squat',
    authoredExerciseName: 'Goblet Squat',
    exerciseSlug: 'goblet-squat',
    equipment: 'kettlebell',
    restSeconds: 90,
    prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 },
    sets: [{ type: 'reps', setNumber: 1, reps: 10, weightKg: 50, rpe: 7 }],
    ...overrides,
  };
}

function skippedSubstitutedBench(order: number): CompletedSessionDto['entries'][number] {
  return entry({
    authoredExerciseId: 'ex-002',
    performedExerciseId: 'ex-008',
    isSubstituted: true,
    isSkipped: true,
    exerciseOrder: order,
    exerciseName: 'Dumbbell Bench Press',
    authoredExerciseName: 'Bench Press',
    exerciseSlug: 'dumbbell-bench-press',
    equipment: 'dumbbell',
    sets: [],
  });
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderList(entries: CompletedSessionDto['entries']): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const view = toCompletedSessionView({
    sessionId: 'session-1',
    workoutName: 'Full Body A',
    programName: 'Fit40 Beginner Strength',
    startedAt: '2026-01-01T10:00:00.000Z',
    completedAt: '2026-01-01T10:45:00.000Z',
    entries,
    metrics: { totalSets: 1, totalReps: 10, totalDurationSeconds: 0, volume: 50 },
  });
  await act(async () => {
    root?.render(createElement(CompletedSessionEntryList, { entries: view.entries }));
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
});

describe('CompletedSessionEntryList — skipped occurrences (M10 Slice 7)', () => {
  it('renders a substituted+skipped occurrence truthfully and never claims performance', async () => {
    await renderList([skippedSubstitutedBench(1)]);
    // Neutral Skipped state, present and visible.
    expect(document.body.textContent).toContain('Skipped');
    // Original/authored identity remains available (substitution context).
    expect(document.body.textContent).toContain('Originally: Bench Press');
    // Primary identity is the selected exercise — but NOT a performance link.
    const benchLink = Array.from(document.querySelectorAll('a')).find((anchor) =>
      anchor.textContent?.includes('Dumbbell Bench Press'),
    );
    expect(benchLink).toBeUndefined();
    // No set rows, no fabricated zero-performance values.
    expect(document.body.textContent).not.toContain('kg');
    expect(document.body.textContent).not.toContain('No sets were logged.');
    // No mutation controls in completed history.
    expect(document.querySelectorAll('button')).toHaveLength(0);
  });

  it('renders a plain skipped occurrence without a redundant original label', async () => {
    await renderList([entry({ isSkipped: true, sets: [], exerciseSlug: 'goblet-squat' })]);
    expect(document.body.textContent).toContain('Skipped');
    // Authored = performed → no "Originally: …" line.
    expect(document.body.textContent).not.toContain('Originally:');
    const squatLink = Array.from(document.querySelectorAll('a')).find((anchor) =>
      anchor.textContent?.includes('Goblet Squat'),
    );
    expect(squatLink).toBeUndefined();
  });

  it('keeps zero-set non-skipped occurrences distinct from skipped', async () => {
    await renderList([entry({ sets: [] })]);
    // Defensive empty behavior — NOT labelled Skipped, link preserved.
    expect(document.body.textContent).not.toContain('Skipped');
    expect(document.body.textContent).toContain('No sets were logged.');
    const squatLink = Array.from(document.querySelectorAll('a')).find((anchor) =>
      anchor.textContent?.includes('Goblet Squat'),
    );
    expect(squatLink).toBeDefined();
  });

  it('preserves the performance-history link for a non-skipped occurrence', async () => {
    await renderList([entry({})]);
    const squatLink = Array.from(document.querySelectorAll('a')).find((anchor) =>
      anchor.textContent?.includes('Goblet Squat'),
    );
    expect(squatLink?.getAttribute('href')).toBe('/history/exercises/goblet-squat');
    // Logged sets still render for genuine performance.
    expect(document.body.textContent).toContain('50 kg × 10 @ RPE 7');
  });

  it('renders a reordered session in persisted DOM order — B, A, C — without sorting', async () => {
    await renderList([
      skippedSubstitutedBench(1), // B — moved up, skipped
      entry({ exerciseOrder: 2 }), // A — genuine squat
      entry({
        exerciseOrder: 3,
        exerciseName: 'Plank',
        exerciseSlug: 'dead-bug',
        sets: [
          { type: 'duration', setNumber: 1, durationSeconds: 45, weightKg: null, rpe: null },
        ],
      }),
    ]);
    const text = document.body.textContent ?? '';
    const benchAt = text.indexOf('Dumbbell Bench Press');
    const squatAt = text.indexOf('Goblet Squat');
    const plankAt = text.indexOf('Plank');
    expect(benchAt).toBeGreaterThan(-1);
    expect(squatAt).toBeGreaterThan(benchAt);
    expect(plankAt).toBeGreaterThan(squatAt);
    // The moved skipped occurrence keeps its state; neighbors keep theirs.
    expect(document.body.textContent).toContain('Skipped');
    expect(document.body.textContent).toContain('50 kg × 10 @ RPE 7');
    expect(document.body.textContent).toContain('45 s');
  });
});
