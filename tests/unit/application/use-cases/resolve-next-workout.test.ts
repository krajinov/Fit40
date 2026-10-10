/**
 * ResolveNextWorkoutUseCase — M17 final review: the degraded next-workout
 * preview must honor the occurrence's authoritative not-performed truth.
 *
 * The recorded fact comes ONLY from GetWorkoutSessionUseCase's
 * `notPerformedRecorded` (the user-scoped read); the use case maps it to the
 * `not-performed` session state, so a recorded occurrence is never
 * `not-started` and never advertised as startable. No client field can spoof it.
 */

import { describe, expect, it, vi } from 'vitest';

import type { ScheduledWorkoutDetailDto } from '@/application/dto/program';
import type { WorkoutSessionDto } from '@/application/dto/workout-session';
import {
  ResolveNextWorkoutUseCase,
  type ResolveNextWorkoutInput,
} from '@/application/use-cases/resolve-next-workout';
import type {
  GetWorkoutSessionError,
  WorkoutSessionView,
} from '@/application/use-cases/get-workout-session';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';
import { err, ok, type Result } from '@/domain/types/result';

function rep() {
  const scheme = createRepScheme(3, 8, 10);
  if (!scheme.ok) throw new Error(scheme.error.message);
  return scheme.data;
}

const WORKOUT: ScheduledWorkoutDetailDto = {
  programSlug: 'prog-1',
  programName: 'Program 1',
  weekNumber: 2,
  order: 1,
  workout: {
    id: 'w1',
    name: 'Push A',
    slug: 'push-a',
    description: 'A workout.',
    estimatedDurationMinutes: 45,
    exercises: [
      {
        order: 1,
        exerciseId: 'ex-1',
        exerciseName: 'Bench Press',
        exerciseSlug: 'bench-press',
        equipment: 'barbell',
        prescription: rep(),
        restSeconds: 90,
        notes: null,
      },
    ],
  },
};

const INPUT = { userId: 'user-a', programSlug: 'prog-1', weekNumber: 2, workoutOrder: 1 } as const;

function sessionDto(status: 'in-progress' | 'completed'): WorkoutSessionDto {
  return {
    sessionId: 's-1',
    scheduledWorkoutId: 'sw-1',
    workoutId: 'w1',
    status,
    startedAt: '2026-10-01T09:00:00.000Z',
    completedAt: status === 'completed' ? '2026-10-01T10:00:00.000Z' : null,
    version: 1,
    exerciseLogs: [],
    metrics: { totalSets: 0, totalReps: 0, totalDurationSeconds: 0, volume: 0, hasExternalLoad: false },
    prescribedSets: 0,
    skippedExerciseCount: 0,
  };
}

function scheduledStub() {
  return { execute: vi.fn(async () => ok(WORKOUT)) };
}

function sessionStub(view: {
  readonly enrolled: boolean;
  readonly session: WorkoutSessionDto | null;
  readonly notPerformedRecorded: boolean;
}) {
  return { execute: vi.fn(async () => ok(view)) };
}

function useCaseFor(session: WorkoutSessionDto | null, notPerformedRecorded: boolean) {
  return new ResolveNextWorkoutUseCase(
    scheduledStub(),
    sessionStub({ enrolled: true, session, notPerformedRecorded }),
  );
}

describe('ResolveNextWorkoutUseCase — recorded truth (M17 final review)', () => {
  it('1. session null + recorded false → not-started (startable, unchanged)', async () => {
    const dto = await useCaseFor(null, false).execute(INPUT);

    expect(dto).not.toBeNull();
    expect(dto?.sessionState).toBe('not-started');
  });

  it('2. session null + recorded true → not-performed, never not-started', async () => {
    const dto = await useCaseFor(null, true).execute(INPUT);

    expect(dto).not.toBeNull();
    expect(dto?.sessionState).toBe('not-performed');
    expect(dto?.sessionState).not.toBe('not-started');
  });

  it('3. an active session is unchanged (in-progress)', async () => {
    const dto = await useCaseFor(sessionDto('in-progress'), false).execute(INPUT);

    expect(dto?.sessionState).toBe('in-progress');
  });

  it('4. a completed session is unchanged', async () => {
    const dto = await useCaseFor(sessionDto('completed'), false).execute(INPUT);

    expect(dto?.sessionState).toBe('not-started');
  });

  it('carries the preview data through for a recorded occurrence', async () => {
    const dto = await useCaseFor(null, true).execute(INPUT);

    expect(dto).toMatchObject({
      programSlug: 'prog-1',
      weekNumber: 2,
      workoutOrder: 1,
      workoutName: 'Push A',
      exerciseCount: 1,
      estimatedMinutes: 45,
    });
  });

  it('8. no client flag can spoof (or un-spoof) the recorded state', async () => {
    // The recorded truth is the session use case's own answer; an extra client
    // field on the input is ignored by construction.
    const useCase = useCaseFor(null, true);
    const spoofed: ResolveNextWorkoutInput & { notPerformedRecorded: boolean } = {
      ...INPUT,
      notPerformedRecorded: false,
    };

    const dto = await useCase.execute(spoofed);

    expect(dto?.sessionState).toBe('not-performed');
  });

  it('7. returns null (no card) when the session read fails — unchanged', async () => {
    const failing = {
      execute: vi.fn(
        async (): Promise<Result<WorkoutSessionView, GetWorkoutSessionError>> =>
          err({ code: 'PROGRAM_NOT_FOUND', slug: 'prog-1', message: 'no' }),
      ),
    };
    const useCase = new ResolveNextWorkoutUseCase(scheduledStub(), failing);

    expect(await useCase.execute(INPUT)).toBeNull();
  });
});
