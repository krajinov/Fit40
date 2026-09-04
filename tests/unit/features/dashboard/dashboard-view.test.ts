/**
 * Unit tests for the dashboard view assembly's next-workout state mapping.
 *
 * buildDashboardView runs the real GetCurrentProgramDashboardUseCase over
 * mocked feature composition roots: the use case is a pure orchestrator, so
 * stubbing its ports' use cases covers the available / unavailable /
 * complete mapping end to end without re-testing the orchestrator itself.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextWorkoutDto } from '@/application/dto/dashboard';
import type { UserProfileDto } from '@/application/dto/user-profile';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

const {
  listEnrollmentsExecute,
  findBySlugExecute,
  getEnrollmentExecute,
  resolveNextExecute,
  listHistoryExecute,
} = vi.hoisted(() => ({
  listEnrollmentsExecute: vi.fn(),
  findBySlugExecute: vi.fn(),
  getEnrollmentExecute: vi.fn(),
  resolveNextExecute: vi.fn(),
  listHistoryExecute: vi.fn(),
}));

vi.mock('@/features/enrollment/services', () => ({
  listUserEnrollmentsUseCase: { execute: listEnrollmentsExecute },
  getProgramEnrollmentUseCase: { execute: getEnrollmentExecute },
}));

vi.mock('@/features/programs/services', () => ({
  getProgramBySlugUseCase: { execute: findBySlugExecute },
}));

vi.mock('@/features/sessions/services', () => ({
  resolveNextWorkoutUseCase: { execute: resolveNextExecute },
}));

vi.mock('@/features/history/services', () => ({
  listTrainingHistoryUseCase: { execute: listHistoryExecute },
}));

import { buildDashboardView } from '@/features/dashboard/dashboard-view';
import type { TrainingHistorySessionDto } from '@/application/dto/training-history';

const PROFILE: UserProfileDto = {
  userId: 'user-a',
  birthYear: 1985,
  experienceLevel: 'beginner',
  primaryGoal: 'strength',
  availableEquipment: ['dumbbell'],
  physicalConsiderations: [],
  preferredDaysPerWeek: 3,
  preferredSessionMinutes: 45,
  heightCm: 178,
  weightKg: 80,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// Real value object — the label formatter reads its structure.
function rep(): RepPrescription {
  const scheme = createRepScheme(3, 8, 10);
  if (!scheme.ok) throw new Error(scheme.error.message);
  return scheme.data;
}

const NEXT_DTO: NextWorkoutDto = {
  programSlug: 'prog-1',
  weekNumber: 2,
  workoutOrder: 1,
  workoutName: 'Push A',
  exerciseCount: 4,
  estimatedMinutes: 45,
  preview: [{ order: 1, exerciseName: 'Bench Press', prescription: rep() }],
  sessionState: 'not-started',
};

const PROGRAM_DETAIL = {
  id: 'p1',
  name: 'Program 1',
  slug: 'prog-1',
  description: 'A program.',
  difficulty: 'beginner',
  goal: 'strength',
  durationWeeks: 4,
  workoutsPerWeek: 3,
  weeks: [
    {
      weekNumber: 1,
      scheduledWorkouts: [
        {
          scheduledWorkoutId: 'sw-1',
          workoutId: 'w1',
          workoutName: 'A',
          workoutSlug: 'a',
          order: 1,
          estimatedDurationMinutes: 30,
        },
      ],
    },
    {
      weekNumber: 2,
      scheduledWorkouts: [
        {
          scheduledWorkoutId: 'sw-2',
          workoutId: 'w2',
          workoutName: 'B',
          workoutSlug: 'b',
          order: 1,
          estimatedDurationMinutes: 30,
        },
      ],
    },
  ],
} as const;

const ENROLLED = {
  status: 'enrolled',
  enrolledAt: '2026-01-01T10:00:00.000Z',
  progress: { totalWorkouts: 2, completedWorkouts: 1, percentage: 50 },
  nextWorkout: { weekNumber: 2, workoutOrder: 1 },
  completedScheduledWorkoutIds: ['sw-1'],
} as const;

function stubProgramAndEnrollment(): void {
  findBySlugExecute.mockResolvedValue({
    ok: true,
    data: { program: { slug: 'prog-1', id: 'p1' }, detail: PROGRAM_DETAIL },
  });
  getEnrollmentExecute.mockResolvedValue({ ok: true, data: ENROLLED });
}

describe('buildDashboardView / nextWorkoutPreview', () => {
  beforeEach(() => {
    listEnrollmentsExecute.mockReset();
    findBySlugExecute.mockReset();
    getEnrollmentExecute.mockReset();
    resolveNextExecute.mockReset();
    listHistoryExecute.mockReset();
    listHistoryExecute.mockResolvedValue({ ok: true, data: { sessions: [], nextCursor: null } });
  });

  it('maps a resolvable next workout to the available state', async () => {
    listEnrollmentsExecute.mockResolvedValue([{ programSlug: 'prog-1' }]);
    stubProgramAndEnrollment();
    resolveNextExecute.mockResolvedValue(NEXT_DTO);

    const view = await buildDashboardView('user-a', PROFILE);

    if (view.currentProgram === null) throw new Error('expected a current program');
    const preview = view.currentProgram.nextWorkoutPreview;
    expect(preview.status).toBe('available');
    if (preview.status !== 'available') return;
    expect(preview.workout.workoutName).toBe('Push A');
    expect(preview.workout.preview[0]?.prescriptionLabel).toBe('3 × 8–10');
  });

  it('maps a failed preview resolution to unavailable — never complete', async () => {
    listEnrollmentsExecute.mockResolvedValue([{ programSlug: 'prog-1' }]);
    stubProgramAndEnrollment();
    resolveNextExecute.mockResolvedValue(null);

    const view = await buildDashboardView('user-a', PROFILE);

    if (view.currentProgram === null) throw new Error('expected a current program');
    expect(view.currentProgram.nextWorkoutPreview).toEqual({ status: 'unavailable' });
    expect(view.currentProgram.nextWorkoutPreview.status).not.toBe('complete');
  });

  it('maps a null enrollment nextWorkout to the complete state', async () => {
    listEnrollmentsExecute.mockResolvedValue([{ programSlug: 'prog-1' }]);
    stubProgramAndEnrollment();
    getEnrollmentExecute.mockResolvedValue({
      ok: true,
      data: { ...ENROLLED, nextWorkout: null, completedScheduledWorkoutIds: ['sw-1', 'sw-2'] },
    });

    const view = await buildDashboardView('user-a', PROFILE);

    if (view.currentProgram === null) throw new Error('expected a current program');
    expect(view.currentProgram.nextWorkoutPreview).toEqual({ status: 'complete' });
    // A completed program must not even query the preview resolver.
    expect(resolveNextExecute).not.toHaveBeenCalled();
  });

  it('keeps week statuses driven by the enrollment, not by preview resolution', async () => {
    listEnrollmentsExecute.mockResolvedValue([{ programSlug: 'prog-1' }]);
    stubProgramAndEnrollment();
    resolveNextExecute.mockResolvedValue(null);

    const view = await buildDashboardView('user-a', PROFILE);

    // The enrollment still has a week-2 next workout: week 1 completed,
    // week 2 in progress — even though the preview is unavailable.
    expect(view.weekSummaries.map((week) => week.status)).toEqual(['completed', 'in-progress']);
  });
});

// ─── Recent training (user-global history read model) ─────────────────────────

function historySessionDto(
  overrides?: Partial<TrainingHistorySessionDto>,
): TrainingHistorySessionDto {
  return {
    sessionId: 'session-1',
    scheduledWorkoutId: 'sw-1',
    workoutId: 'w1',
    workoutName: 'Push A',
    programName: 'Program 1',
    startedAt: '2026-02-15T10:00:00.000Z',
    completedAt: '2026-02-15T11:00:00.000Z',
    exerciseLogs: [],
    metrics: { totalSets: 12, totalReps: 96, totalDurationSeconds: 0, volume: 4800 },
    ...overrides,
  };
}

describe('buildDashboardView / recentTraining', () => {
  beforeEach(() => {
    listEnrollmentsExecute.mockReset();
    findBySlugExecute.mockReset();
    getEnrollmentExecute.mockReset();
    resolveNextExecute.mockReset();
    listHistoryExecute.mockReset();
    listHistoryExecute.mockResolvedValue({ ok: true, data: { sessions: [], nextCursor: null } });
  });

  function stubCurrentProgram(): void {
    listEnrollmentsExecute.mockResolvedValue([{ programSlug: 'prog-1' }]);
    stubProgramAndEnrollment();
    resolveNextExecute.mockResolvedValue(NEXT_DTO);
  }

  it('reads recent training from the History use case with the small bounded limit', async () => {
    stubCurrentProgram();
    listHistoryExecute.mockResolvedValue({
      ok: true,
      data: {
        sessions: [historySessionDto()],
        nextCursor: null,
      },
    });

    const view = await buildDashboardView('user-a', PROFILE);

    expect(listHistoryExecute).toHaveBeenCalledTimes(1);
    expect(listHistoryExecute).toHaveBeenCalledWith({ userId: 'user-a', limit: 3 });

    expect(view.recentTraining.status).toBe('loaded');
    if (view.recentTraining.status !== 'loaded') return;
    expect(view.recentTraining.sessions).toHaveLength(1);
    expect(view.recentTraining.sessions[0]).toEqual({
      sessionId: 'session-1',
      workoutName: 'Push A',
      programName: 'Program 1',
      completedAtLabel: 'Feb 15, 2026',
      setsLabel: '12 sets',
    });
  });

  it('preserves the history read model order (newest first) without re-sorting', async () => {
    stubCurrentProgram();
    listHistoryExecute.mockResolvedValue({
      ok: true,
      data: {
        sessions: [
          historySessionDto({ sessionId: 'newest', workoutName: 'Newest Session' }),
          historySessionDto({
            sessionId: 'middle',
            workoutName: 'Middle Session',
            completedAt: '2026-02-10T11:00:00.000Z',
          }),
          historySessionDto({
            sessionId: 'oldest',
            workoutName: 'Oldest Session',
            completedAt: '2026-02-01T11:00:00.000Z',
          }),
        ],
        nextCursor: null,
      },
    });

    const view = await buildDashboardView('user-a', PROFILE);

    if (view.recentTraining.status !== 'loaded') throw new Error('expected loaded');
    expect(view.recentTraining.sessions.map((session) => session.sessionId)).toEqual([
      'newest',
      'middle',
      'oldest',
    ]);
  });

  it('accepts user-global history from other programs and detached sessions unfiltered', async () => {
    stubCurrentProgram();
    listHistoryExecute.mockResolvedValue({
      ok: true,
      data: {
        sessions: [
          historySessionDto({
            sessionId: 'detached-1',
            programName: 'Previous Program',
            workoutName: 'Detached Workout',
          }),
          historySessionDto({
            sessionId: 'other-2',
            programName: 'Another Old Program',
          }),
        ],
        nextCursor: null,
      },
    });

    const view = await buildDashboardView('user-a', PROFILE);

    // History is user-global: sessions from enrollments the user has since
    // left (or other programs entirely) are shown as-is, not filtered to the
    // current enrollment.
    if (view.recentTraining.status !== 'loaded') throw new Error('expected loaded');
    expect(view.recentTraining.sessions.map((session) => session.programName)).toEqual([
      'Previous Program',
      'Another Old Program',
    ]);
  });

  it('reads recent training even when the user has no current program', async () => {
    listEnrollmentsExecute.mockResolvedValue([]);
    listHistoryExecute.mockResolvedValue({
      ok: true,
      data: { sessions: [historySessionDto({ sessionId: 'orphan' })], nextCursor: null },
    });

    const view = await buildDashboardView('user-a', PROFILE);

    expect(view.currentProgram).toBeNull();
    expect(view.recentTraining).toEqual({
      status: 'loaded',
      sessions: [expect.objectContaining({ sessionId: 'orphan' })],
    });
  });

  it('keeps genuine empty history distinct from a failed history read', async () => {
    stubCurrentProgram();
    listHistoryExecute.mockResolvedValue({
      ok: true,
      data: { sessions: [], nextCursor: null },
    });

    const emptyView = await buildDashboardView('user-a', PROFILE);
    expect(emptyView.recentTraining).toEqual({ status: 'loaded', sessions: [] });

    listHistoryExecute.mockRejectedValue(new Error('db unreachable'));
    const failedView = await buildDashboardView('user-a', PROFILE);
    expect(failedView.recentTraining).toEqual({ status: 'unavailable' });
  });

  it('maps a typed history rejection to unavailable — never to empty', async () => {
    stubCurrentProgram();
    listHistoryExecute.mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'bad cursor' },
    });

    const view = await buildDashboardView('user-a', PROFILE);

    expect(view.recentTraining).toEqual({ status: 'unavailable' });
  });
});

