/**
 * Unit tests for the dashboard view assembly's next-workout state mapping.
 *
 * buildDashboardView runs the real GetCurrentProgramDashboardUseCase over
 * mocked feature composition roots: the use case is a pure orchestrator, so
 * stubbing its ports' use cases covers the available / unavailable /
 * complete mapping end to end without re-testing the orchestrator itself.
 * The M13 insights read is stubbed at the feature composition root for the
 * same reason: unit tests exercise the mapping, never the database.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextWorkoutDto } from '@/application/dto/dashboard';
import type {
  TrainingWeeklyInsightsDto,
  WeeklyInsightWeekDto,
} from '@/application/dto/training-insights';
import type { UserProfileDto } from '@/application/dto/user-profile';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

const {
  listEnrollmentsExecute,
  findBySlugExecute,
  getEnrollmentExecute,
  resolveNextExecute,
  listHistoryExecute,
  weeklyInsightsExecute,
} = vi.hoisted(() => ({
  listEnrollmentsExecute: vi.fn(),
  findBySlugExecute: vi.fn(),
  getEnrollmentExecute: vi.fn(),
  resolveNextExecute: vi.fn(),
  listHistoryExecute: vi.fn(),
  weeklyInsightsExecute: vi.fn(),
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

// The dashboard feature root also composes the insights use case over the
// shared Drizzle repository singletons. Unit tests replace that use case (no
// database) and neutralise the repository module so its postgres client
// never initialises in the node test environment.
vi.mock('@/infrastructure/database/repositories', () => ({
  exerciseRepository: {},
  personalRecordRepository: {},
  trainingHistoryRepository: {},
}));

vi.mock('@/features/dashboard/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/dashboard/services')>();
  return {
    ...actual,
    getTrainingWeeklyInsightsUseCase: { execute: weeklyInsightsExecute },
  };
});

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

// Fixed request clock: Wednesday of the 2026-02-16 UTC training week. The
// presentation layer never calls Date.now(); the caller supplies the instant.
const NOW = new Date('2026-02-18T09:30:00.000Z');

/** Eight Monday week windows, oldest → newest (current week last). */
const WEEK_STARTS = [
  '2025-12-29T00:00:00.000Z',
  '2026-01-05T00:00:00.000Z',
  '2026-01-12T00:00:00.000Z',
  '2026-01-19T00:00:00.000Z',
  '2026-01-26T00:00:00.000Z',
  '2026-02-02T00:00:00.000Z',
  '2026-02-09T00:00:00.000Z',
  '2026-02-16T00:00:00.000Z',
] as const;

function insightWeek(
  weekStart: string,
  completedWorkouts: number,
  loggedSets: number,
): WeeklyInsightWeekDto {
  return { weekStart, completedWorkouts, loggedSets };
}

/** Successful insights read: 3 workouts / 14 sets this week vs 2 / 0 last. */
function insightsDtoFixture(): TrainingWeeklyInsightsDto {
  const currentWeek = insightWeek('2026-02-16T00:00:00.000Z', 3, 14);
  const previousWeek = insightWeek('2026-02-09T00:00:00.000Z', 2, 0);
  return {
    weekStart: currentWeek.weekStart,
    weeks: [
      insightWeek('2025-12-29T00:00:00.000Z', 0, 0),
      insightWeek('2026-01-05T00:00:00.000Z', 1, 8),
      insightWeek('2026-01-12T00:00:00.000Z', 0, 0),
      insightWeek('2026-01-19T00:00:00.000Z', 2, 12),
      insightWeek('2026-01-26T00:00:00.000Z', 0, 0),
      insightWeek('2026-02-02T00:00:00.000Z', 1, 10),
      previousWeek,
      currentWeek,
    ],
    summary: {
      currentWeek,
      previousWeek,
      workoutDelta: 1,
      setDelta: 14,
      currentPersonalBestsSetThisWeek: 1,
    },
    recentPersonalBests: [],
  };
}

/** Same shape, both weeks trained zero times — authoritative zeros. */
function emptyInsightsDtoFixture(): TrainingWeeklyInsightsDto {
  const currentWeek = insightWeek('2026-02-16T00:00:00.000Z', 0, 0);
  const previousWeek = insightWeek('2026-02-09T00:00:00.000Z', 0, 0);
  return {
    weekStart: currentWeek.weekStart,
    weeks: WEEK_STARTS.map((weekStart) => insightWeek(weekStart, 0, 0)),
    summary: {
      currentWeek,
      previousWeek,
      workoutDelta: 0,
      setDelta: 0,
      currentPersonalBestsSetThisWeek: 0,
    },
    recentPersonalBests: [],
  };
}

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
    weeklyInsightsExecute.mockReset();
    weeklyInsightsExecute.mockResolvedValue({ ok: true, data: insightsDtoFixture() });
  });

  it('maps a resolvable next workout to the available state', async () => {
    listEnrollmentsExecute.mockResolvedValue([{ programSlug: 'prog-1' }]);
    stubProgramAndEnrollment();
    resolveNextExecute.mockResolvedValue(NEXT_DTO);

    const view = await buildDashboardView('user-a', PROFILE, NOW);

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

    const view = await buildDashboardView('user-a', PROFILE, NOW);

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

    const view = await buildDashboardView('user-a', PROFILE, NOW);

    if (view.currentProgram === null) throw new Error('expected a current program');
    expect(view.currentProgram.nextWorkoutPreview).toEqual({ status: 'complete' });
    // A completed program must not even query the preview resolver.
    expect(resolveNextExecute).not.toHaveBeenCalled();
  });

  it('keeps week statuses driven by the enrollment, not by preview resolution', async () => {
    listEnrollmentsExecute.mockResolvedValue([{ programSlug: 'prog-1' }]);
    stubProgramAndEnrollment();
    resolveNextExecute.mockResolvedValue(null);

    const view = await buildDashboardView('user-a', PROFILE, NOW);

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
    weeklyInsightsExecute.mockReset();
    weeklyInsightsExecute.mockResolvedValue({ ok: true, data: insightsDtoFixture() });
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

    const view = await buildDashboardView('user-a', PROFILE, NOW);

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

    const view = await buildDashboardView('user-a', PROFILE, NOW);

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

    const view = await buildDashboardView('user-a', PROFILE, NOW);

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

    const view = await buildDashboardView('user-a', PROFILE, NOW);

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

    const emptyView = await buildDashboardView('user-a', PROFILE, NOW);
    expect(emptyView.recentTraining).toEqual({ status: 'loaded', sessions: [] });

    listHistoryExecute.mockRejectedValue(new Error('db unreachable'));
    const failedView = await buildDashboardView('user-a', PROFILE, NOW);
    expect(failedView.recentTraining).toEqual({ status: 'unavailable' });
  });

  it('records an unexpected history-read failure before degrading to unavailable', async () => {
    stubCurrentProgram();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      listHistoryExecute.mockRejectedValue(new Error('db unreachable'));

      const view = await buildDashboardView('user-a', PROFILE, NOW);

      expect(view.recentTraining).toEqual({ status: 'unavailable' });
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]?.[0]).toContain('user user-a');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('does not log expected empty, loaded, or typed-failure history outcomes', async () => {
    stubCurrentProgram();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      listHistoryExecute.mockResolvedValue({
        ok: true,
        data: { sessions: [], nextCursor: null },
      });
      await buildDashboardView('user-a', PROFILE, NOW);

      listHistoryExecute.mockResolvedValue({
        ok: true,
        data: { sessions: [historySessionDto()], nextCursor: null },
      });
      await buildDashboardView('user-a', PROFILE, NOW);

      listHistoryExecute.mockResolvedValue({
        ok: false,
        error: { code: 'INVALID_INPUT', message: 'bad cursor' },
      });
      await buildDashboardView('user-a', PROFILE, NOW);

      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('maps a typed history rejection to unavailable — never to empty', async () => {
    stubCurrentProgram();
    listHistoryExecute.mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'bad cursor' },
    });

    const view = await buildDashboardView('user-a', PROFILE, NOW);

    expect(view.recentTraining).toEqual({ status: 'unavailable' });
  });
});

describe('buildDashboardView / weeklyInsights (M13)', () => {
  beforeEach(() => {
    listEnrollmentsExecute.mockReset();
    listEnrollmentsExecute.mockResolvedValue([]);
    findBySlugExecute.mockReset();
    getEnrollmentExecute.mockReset();
    resolveNextExecute.mockReset();
    listHistoryExecute.mockReset();
    listHistoryExecute.mockResolvedValue({ ok: true, data: { sessions: [], nextCursor: null } });
    weeklyInsightsExecute.mockReset();
    weeklyInsightsExecute.mockResolvedValue({ ok: true, data: insightsDtoFixture() });
  });

  it('hands the request clock and user to the insights use case', async () => {
    const view = await buildDashboardView('user-a', PROFILE, NOW);

    expect(weeklyInsightsExecute).toHaveBeenCalledTimes(1);
    expect(weeklyInsightsExecute).toHaveBeenCalledWith({ userId: 'user-a', now: NOW });
    expect(view.weeklyInsights.status).toBe('loaded');
  });

  it('maps a successful zero-training read to loaded — empty is data, not an error', async () => {
    weeklyInsightsExecute.mockResolvedValue({ ok: true, data: emptyInsightsDtoFixture() });

    const view = await buildDashboardView('user-a', PROFILE, NOW);

    expect(view.weeklyInsights.status).toBe('loaded');
    if (view.weeklyInsights.status !== 'loaded') return;
    expect(view.weeklyInsights.data.comparisonLabel).toBe(
      'No training in the last two weeks.',
    );
    expect(view.weeklyInsights.data.stats[0]).toEqual({ label: 'Workouts', value: '0' });
    expect(view.weeklyInsights.data.activityWeeks).toHaveLength(8);
  });

  it('keeps insights available without a current program (user-global read)', async () => {
    const view = await buildDashboardView('user-a', PROFILE, NOW);

    expect(view.currentProgram).toBeNull();
    expect(view.weeklyInsights.status).toBe('loaded');
  });

  it('maps a typed insights rejection to unavailable without logging', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      weeklyInsightsExecute.mockResolvedValue({
        ok: false,
        error: { code: 'INVALID_INPUT', message: 'bad user' },
      });

      const view = await buildDashboardView('user-a', PROFILE, NOW);

      expect(view.weeklyInsights).toEqual({ status: 'unavailable' });
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('records an unexpected insights failure before degrading to unavailable', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      weeklyInsightsExecute.mockRejectedValue(new Error('db unreachable'));

      const view = await buildDashboardView('user-a', PROFILE, NOW);

      expect(view.weeklyInsights).toEqual({ status: 'unavailable' });
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain('user user-a');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('leaves the rest of the dashboard usable when the insights read fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      weeklyInsightsExecute.mockRejectedValue(new Error('db unreachable'));

      const view = await buildDashboardView('user-a', PROFILE, NOW);

      expect(view.weeklyInsights).toEqual({ status: 'unavailable' });
      expect(view.recentTraining).toEqual({ status: 'loaded', sessions: [] });
      expect(view.weekSummaries).toEqual([]);
      expect(view.profile).toBe(PROFILE);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

