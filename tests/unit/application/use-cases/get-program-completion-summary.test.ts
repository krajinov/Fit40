/**
 * M14 Slice 4 — GetProgramCompletionSummaryUseCase orchestration.
 *
 * The ports are stubbed, so these tests lock the composition: the three
 * authoritative outcomes, the cheap incomplete path (no session hydration, no
 * record read, no catalog read), the exact M12 pipeline reuse (historical
 * PR-at-the-time semantics, never M13 current-best semantics), the display cap
 * with its newest-by-ladder ordering, batched and deduplicated metadata
 * resolution, and the performed-identity definition of "exercises trained".
 *
 * The Domain's own strictness table (first exposure, strictly greater, equal)
 * is exercised here through the real `resolveRecordEvents` over stubbed
 * best-before answers; the real PostgreSQL pipeline with a user-global oracle
 * lives in the integration suite.
 */

import { describe, expect, it, vi } from 'vitest';

import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type { PersonalRecordRepository } from '@/application/ports/personal-record-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';
import type { CompletedWorkoutSession } from '@/application/ports/training-history-repository';
import type { WorkoutSessionRepository } from '@/application/ports/workout-session-repository';
import {
  PROGRAM_COMPLETION_RECORD_EVENT_LIMIT,
  type ProgramCompletionCompletedDto,
  type ProgramCompletionSummaryDto,
} from '@/application/dto/program-completion';
import { GetProgramCompletionSummaryUseCase } from '@/application/use-cases/get-program-completion-summary';
import { createExercise, type Exercise } from '@/domain/entities/exercise';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import { createTrainingProgram, type TrainingProgram } from '@/domain/entities/training-program';
import { createWorkout } from '@/domain/entities/workout';
import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
  OccurrenceSource,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import type { RecordCandidate } from '@/domain/services/personal-record-metrics';
import type { CandidatePriorBest } from '@/domain/services/personal-records';
import { Difficulty, EquipmentType, MovementPattern, MuscleGroup } from '@/domain/types/exercise';
import {
  createEnrollmentId,
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
  type ExerciseId,
  type ScheduledWorkoutId,
} from '@/domain/types/ids';
import { ProgramGoal } from '@/domain/types/program';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';
import { InMemoryProgramEnrollmentRepository } from '@/infrastructure/enrollments/in-memory-program-enrollment-repository';

const PROGRAM_ID = 'p1';
const PROGRAM_SLUG = 'program-one';
const SCHED_A = 'sched-a';
const SCHED_B = 'sched-b';

function uid(value: string) {
  const result = createUserId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function eid(value: string) {
  const result = createExerciseId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function wid(value: string) {
  const result = createWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function scheduledId(value: string) {
  const result = createScheduledWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function enid(value: string) {
  const result = createEnrollmentId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function repScheme() {
  const result = createRepScheme(3, 8, 10);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function makeExercise(id: string): Exercise {
  const result = createExercise({
    id,
    name: `Exercise ${id}`,
    slug: `exercise-${id}`,
    description: 'A test exercise.',
    primaryMuscle: MuscleGroup.Chest,
    secondaryMuscles: [],
    equipment: EquipmentType.Dumbbell,
    difficulty: Difficulty.Beginner,
    movementPattern: MovementPattern.PushHorizontal,
    considerations: [],
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** A one-week program with two scheduled workouts (two templates). */
function makeProgram(): TrainingProgram {
  const workoutA = createWorkout({
    id: 'wo-a',
    name: 'Workout A',
    slug: 'workout-a',
    description: 'A test workout.',
    estimatedDurationMinutes: 30,
    exercises: [{ exerciseId: eid('ex-001'), order: 1, prescription: repScheme(), restSeconds: 60 }],
  });
  const workoutB = createWorkout({
    id: 'wo-b',
    name: 'Workout B',
    slug: 'workout-b',
    description: 'A test workout.',
    estimatedDurationMinutes: 30,
    exercises: [{ exerciseId: eid('ex-002'), order: 1, prescription: repScheme(), restSeconds: 60 }],
  });
  if (!workoutA.ok) throw new Error(workoutA.error.message);
  if (!workoutB.ok) throw new Error(workoutB.error.message);

  const program = createTrainingProgram({
    id: PROGRAM_ID,
    name: 'Program One',
    slug: PROGRAM_SLUG,
    description: 'A test program.',
    difficulty: Difficulty.Beginner,
    goal: ProgramGoal.Strength,
    durationWeeks: 1,
    workoutsPerWeek: 2,
    workouts: [workoutA.data, workoutB.data],
    weeks: [
      {
        weekNumber: 1,
        scheduledWorkouts: [
          { id: scheduledId(SCHED_A), workoutId: workoutA.data.id, order: 1 },
          { id: scheduledId(SCHED_B), workoutId: workoutB.data.id, order: 2 },
        ],
      },
    ],
  });
  if (!program.ok) throw new Error(program.error.message);
  return program.data;
}

interface OccurrenceSpec {
  readonly authored: string;
  /** Performed identity when it differs from the authored one (substitution). */
  readonly performed?: string;
  readonly source?: OccurrenceSource;
  readonly isSkipped?: boolean;
  readonly sets?: ReadonlyArray<{ readonly reps: number; readonly weightKg: number | null }>;
}

/** Builds a real completed aggregate through the Domain factories. */
function completedSession(input: {
  readonly id: string;
  readonly scheduledWorkoutId: string;
  readonly workoutId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly occurrences: ReadonlyArray<OccurrenceSpec>;
}): CompletedWorkoutSession {
  const created = createWorkoutSession({
    id: input.id,
    userId: uid('user-a'),
    enrollmentId: enid('enr-1'),
    scheduledWorkoutId: scheduledId(input.scheduledWorkoutId),
    workoutId: wid(input.workoutId),
    startedAt: new Date(input.startedAt),
    exerciseLogs: input.occurrences.map((occurrence, index) => ({
      authoredExerciseId: eid(occurrence.authored),
      order: index + 1,
      prescription: repScheme(),
      restSeconds: 60,
      ...(occurrence.performed === undefined
        ? {}
        : { performedExerciseId: eid(occurrence.performed) }),
      ...(occurrence.source === undefined ? {} : { source: occurrence.source }),
      ...(occurrence.isSkipped === undefined ? {} : { isSkipped: occurrence.isSkipped }),
    })),
  });
  if (!created.ok) throw new Error(created.error.message);

  let session: WorkoutSession = created.data;
  for (const [index, occurrence] of input.occurrences.entries()) {
    for (const set of occurrence.sets ?? []) {
      const logged = logSessionSet(session, {
        exerciseOrder: index + 1,
        type: 'reps',
        reps: set.reps,
        weightKg: set.weightKg,
        rpe: null,
      });
      if (!logged.ok) throw new Error(logged.error.message);
      session = logged.data;
    }
  }

  const done = completeWorkoutSession(session, new Date(input.completedAt));
  if (!done.ok) throw new Error(done.error.message);
  const completedAt = done.data.completedAt;
  if (completedAt === null) throw new Error('unreachable: completion sets completedAt');
  return { ...done.data, completedAt };
}

/** The run's first scheduled workout, completed with one ex-001 set at 40 kg. */
function sessionA(): CompletedWorkoutSession {
  return completedSession({
    id: 'session-a',
    scheduledWorkoutId: SCHED_A,
    workoutId: 'wo-a',
    startedAt: '2026-02-01T10:00:00Z',
    completedAt: '2026-02-01T11:00:00Z',
    occurrences: [{ authored: 'ex-001', sets: [{ reps: 10, weightKg: 40 }] }],
  });
}

/** The run's second scheduled workout, completed with one ex-002 set at 20 kg. */
function sessionB(): CompletedWorkoutSession {
  return completedSession({
    id: 'session-b',
    scheduledWorkoutId: SCHED_B,
    workoutId: 'wo-b',
    startedAt: '2026-02-02T10:00:00Z',
    completedAt: '2026-02-02T11:00:00Z',
    occurrences: [{ authored: 'ex-002', sets: [{ reps: 10, weightKg: 20 }] }],
  });
}

function makeProgramRepo(program: TrainingProgram | null) {
  return {
    list: vi.fn(),
    findBySlug: vi.fn(async () => program),
    findSessionRouteByScheduledWorkoutId: vi.fn(),
    listMetadataByIds: vi.fn(),
  } satisfies ProgramRepository;
}

function makeSessionRepo(options: {
  readonly completedIds?: ReadonlyArray<ScheduledWorkoutId>;
  readonly sessions?: ReadonlyArray<CompletedWorkoutSession>;
}) {
  return {
    findById: vi.fn(),
    findByEnrollmentAndScheduledWorkout: vi.fn(),
    save: vi.fn(),
    listCompletedScheduledWorkoutIds: vi.fn(async () => options.completedIds ?? []),
    listInProgressScheduledWorkoutIds: vi.fn(async () => []),
    listCompletedByEnrollment: vi.fn(async () => options.sessions ?? []),
  } satisfies WorkoutSessionRepository;
}

/**
 * A record-repository stub whose best-before answers are supplied per
 * candidate, so the composition's historical-event behaviour is observable
 * without duplicating any M12 logic.
 */
function makeRecordRepo(options: {
  readonly bestBefore?: (candidate: RecordCandidate) => number | null;
  readonly failure?: Error;
}) {
  const bestBefore = options.bestBefore ?? (() => null);
  return {
    findCurrentPersonalBests: vi.fn(),
    findCurrentPersonalBestsSetBetween: vi.fn(),
    findBestValuesBefore: vi
      .fn<PersonalRecordRepository['findBestValuesBefore']>()
      .mockImplementation(async (_userId, candidates) => {
        if (options.failure !== undefined) throw options.failure;
        return candidates.map(
          (candidate): CandidatePriorBest => ({
            candidate,
            bestBefore: bestBefore(candidate),
          }),
        );
      }),
  } satisfies PersonalRecordRepository;
}

function makeExerciseRepo(exercises: ReadonlyArray<Exercise>) {
  return {
    list: vi.fn(),
    findBySlug: vi.fn(),
    findByIds: vi.fn(async (ids: ReadonlyArray<ExerciseId>) =>
      exercises.filter((exercise) => ids.includes(exercise.id)),
    ),
  } satisfies ExerciseRepository;
}

async function makeHarness(options: {
  readonly program?: TrainingProgram | null;
  readonly enrolled?: boolean;
  readonly completedIds?: ReadonlyArray<ScheduledWorkoutId>;
  readonly sessions?: ReadonlyArray<CompletedWorkoutSession>;
  readonly bestBefore?: (candidate: RecordCandidate) => number | null;
  readonly recordFailure?: Error;
  readonly exercises?: ReadonlyArray<Exercise>;
}) {
  const programRepo = makeProgramRepo(
    options.program === undefined ? makeProgram() : options.program,
  );
  const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
  if (options.enrolled !== false) {
    const enrollment = createProgramEnrollment({
      id: 'enr-1',
      userId: 'user-a',
      programId: PROGRAM_ID,
      enrolledAt: new Date('2026-01-01T00:00:00Z'),
    });
    if (!enrollment.ok) throw new Error(enrollment.error.message);
    await enrollmentRepo.create(enrollment.data);
  }

  const sessionRepo = makeSessionRepo({
    completedIds: options.completedIds,
    sessions: options.sessions,
  });
  const recordRepo = makeRecordRepo({
    bestBefore: options.bestBefore,
    failure: options.recordFailure,
  });
  const exerciseRepo = makeExerciseRepo(options.exercises ?? []);

  return {
    useCase: new GetProgramCompletionSummaryUseCase(
      programRepo,
      enrollmentRepo,
      sessionRepo,
      recordRepo,
      exerciseRepo,
    ),
    programRepo,
    sessionRepo,
    recordRepo,
    exerciseRepo,
  };
}

describe('GetProgramCompletionSummaryUseCase', () => {
  describe('authoritative states', () => {
    it('rejects an invalid userId before touching any repository', async () => {
      const { useCase, programRepo, sessionRepo, recordRepo, exerciseRepo } = await makeHarness({});

      const result = await useCase.execute({ userId: '   ', programSlug: PROGRAM_SLUG });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(programRepo.findBySlug).not.toHaveBeenCalled();
      expect(sessionRepo.listCompletedScheduledWorkoutIds).not.toHaveBeenCalled();
      expect(recordRepo.findBestValuesBefore).not.toHaveBeenCalled();
      expect(exerciseRepo.findByIds).not.toHaveBeenCalled();
    });

    it('reports PROGRAM_NOT_FOUND for an unknown program slug', async () => {
      const { useCase, sessionRepo } = await makeHarness({ program: null });

      const result = await useCase.execute({ userId: 'user-a', programSlug: 'missing' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('PROGRAM_NOT_FOUND');
      expect(sessionRepo.listCompletedScheduledWorkoutIds).not.toHaveBeenCalled();
    });

    it('returns null when the user is not enrolled, without any session, record or catalog read', async () => {
      const { useCase, sessionRepo, recordRepo, exerciseRepo } = await makeHarness({
        enrolled: false,
        completedIds: [scheduledId(SCHED_A)],
        sessions: [sessionA()],
        exercises: [makeExercise('ex-001')],
      });

      const result = await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

      expect(result).toEqual({ ok: true, data: null });
      expect(sessionRepo.listCompletedScheduledWorkoutIds).not.toHaveBeenCalled();
      expect(sessionRepo.listCompletedByEnrollment).not.toHaveBeenCalled();
      expect(recordRepo.findBestValuesBefore).not.toHaveBeenCalled();
      expect(exerciseRepo.findByIds).not.toHaveBeenCalled();
    });

    it("returns null for another user's run: the enrollment lookup uses the trusted user id", async () => {
      const { useCase, sessionRepo, recordRepo } = await makeHarness({
        completedIds: [scheduledId(SCHED_A), scheduledId(SCHED_B)],
        sessions: [sessionA(), sessionB()],
      });

      // user-a owns the seeded enrollment; user-b must see nothing of it.
      const result = await useCase.execute({ userId: 'user-b', programSlug: PROGRAM_SLUG });

      expect(result).toEqual({ ok: true, data: null });
      expect(sessionRepo.listCompletedScheduledWorkoutIds).not.toHaveBeenCalled();
      expect(recordRepo.findBestValuesBefore).not.toHaveBeenCalled();
    });
  });

  describe('incomplete run (cheap path)', () => {
    it('reports the incomplete state with the domain progress counts', async () => {
      const { useCase } = await makeHarness({ completedIds: [scheduledId(SCHED_A)] });

      const result = await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toEqual({
        status: 'incomplete',
        completedWorkouts: 1,
        totalWorkouts: 2,
      });
    });

    it('does not hydrate the run sessions', async () => {
      const { useCase, sessionRepo } = await makeHarness({ completedIds: [] });

      await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

      expect(sessionRepo.listCompletedByEnrollment).not.toHaveBeenCalled();
    });

    it('does not read personal records', async () => {
      const { useCase, recordRepo } = await makeHarness({ completedIds: [scheduledId(SCHED_A)] });

      await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

      expect(recordRepo.findBestValuesBefore).not.toHaveBeenCalled();
      expect(recordRepo.findCurrentPersonalBests).not.toHaveBeenCalled();
      expect(recordRepo.findCurrentPersonalBestsSetBetween).not.toHaveBeenCalled();
    });

    it('does not read the exercise catalog', async () => {
      const { useCase, exerciseRepo } = await makeHarness({
        completedIds: [scheduledId(SCHED_A)],
      });

      await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

      expect(exerciseRepo.findByIds).not.toHaveBeenCalled();
    });
  });

  describe('completed run facts', () => {
    it('reports the completed state with the run identity, counts and completion instant', async () => {
      const { useCase } = await makeHarness({
        completedIds: [scheduledId(SCHED_A), scheduledId(SCHED_B)],
        sessions: [sessionA(), sessionB()],
        exercises: [makeExercise('ex-001'), makeExercise('ex-002')],
      });

      const result = await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

      const summary = expectCompleted(result.ok ? result.data : null);
      expect(summary.programName).toBe('Program One');
      expect(summary.programSlug).toBe(PROGRAM_SLUG);
      expect(summary.completedWorkouts).toBe(2);
      expect(summary.totalWorkouts).toBe(2);
      // The latest of the run's OWN completed sessions.
      expect(summary.completedAt).toBe('2026-02-02T11:00:00.000Z');
      expect(summary.distinctExercises).toBe(2);
      // Both logged sets are first exposures under the default stub answer.
      expect(summary.recordEventCount).toBe(2);
      expect(summary.recordEvents.map((event) => event.exerciseId)).toEqual(['ex-002', 'ex-001']);
    });

    it("uses the completion date of the run's own scheduled sessions only", async () => {
      // A completed session whose scheduled workout is NOT in this program
      // (catalog drift) carries the latest timestamp: it must never become the
      // completion date.
      const drifted = completedSession({
        id: 'session-drifted',
        scheduledWorkoutId: 'sched-unknown-to-program',
        workoutId: 'wo-drifted',
        startedAt: '2026-03-01T10:00:00Z',
        completedAt: '2026-03-01T11:00:00Z',
        occurrences: [{ authored: 'ex-001', sets: [{ reps: 5, weightKg: 10 }] }],
      });
      const { useCase } = await makeHarness({
        completedIds: [scheduledId(SCHED_A), scheduledId(SCHED_B)],
        sessions: [sessionA(), sessionB(), drifted],
        // Suppress every event so this test observes the date contract alone.
        bestBefore: () => 1000,
        exercises: [makeExercise('ex-001'), makeExercise('ex-002')],
      });

      const result = await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

      const summary = expectCompleted(result.ok ? result.data : null);
      expect(summary.completedAt).toBe('2026-02-02T11:00:00.000Z');
      expect(summary.recordEventCount).toBe(0);
      expect(summary.recordEvents).toEqual([]);
    });

    it('counts distinct PERFORMED exercises, deduplicated across the run', async () => {
      // Two occurrences of ex-001 inside one session count once.
      const repeated = completedSession({
        id: 'session-repeated',
        scheduledWorkoutId: SCHED_A,
        workoutId: 'wo-a',
        startedAt: '2026-02-01T10:00:00Z',
        completedAt: '2026-02-01T11:00:00Z',
        occurrences: [
          { authored: 'ex-001', sets: [{ reps: 10, weightKg: 40 }] },
          { authored: 'ex-001', sets: [{ reps: 10, weightKg: 35 }] },
        ],
      });
      const { useCase } = await makeHarness({
        completedIds: [scheduledId(SCHED_A), scheduledId(SCHED_B)],
        sessions: [repeated, sessionB()],
        bestBefore: () => 1000,
        exercises: [makeExercise('ex-001'), makeExercise('ex-002')],
      });

      const result = await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

      expect(expectCompleted(result.ok ? result.data : null).distinctExercises).toBe(2);
    });

    it('counts a substituted occurrence as the replacement, never the authored exercise', async () => {
      const substituted = completedSession({
        id: 'session-substituted',
        scheduledWorkoutId: SCHED_A,
        workoutId: 'wo-a',
        startedAt: '2026-02-01T10:00:00Z',
        completedAt: '2026-02-01T11:00:00Z',
        // Authored ex-001, performed ex-003: only ex-003 counts as trained.
        occurrences: [
          { authored: 'ex-001', performed: 'ex-003', sets: [{ reps: 10, weightKg: 40 }] },
        ],
      });
      const { useCase } = await makeHarness({
        completedIds: [scheduledId(SCHED_A), scheduledId(SCHED_B)],
        sessions: [substituted, sessionB()],
        bestBefore: () => 1000,
        exercises: [makeExercise('ex-002'), makeExercise('ex-003')],
      });

      const result = await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

      // ex-003 (performed) + ex-002; the authored ex-001 is not trained identity.
      expect(expectCompleted(result.ok ? result.data : null).distinctExercises).toBe(2);
    });

    it('counts a user-added occurrence as a trained exercise', async () => {
      const withUserAdded = completedSession({
        id: 'session-user-added',
        scheduledWorkoutId: SCHED_A,
        workoutId: 'wo-a',
        startedAt: '2026-02-01T10:00:00Z',
        completedAt: '2026-02-01T11:00:00Z',
        occurrences: [
          {
            authored: 'ex-004',
            source: OccurrenceSource.UserAdded,
            sets: [{ reps: 12, weightKg: 15 }],
          },
        ],
      });
      const { useCase } = await makeHarness({
        completedIds: [scheduledId(SCHED_A), scheduledId(SCHED_B)],
        sessions: [withUserAdded, sessionB()],
        bestBefore: () => 1000,
        exercises: [makeExercise('ex-002'), makeExercise('ex-004')],
      });

      const result = await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

      // ex-004 (user added) + ex-002 — the user-added occurrence participated.
      expect(expectCompleted(result.ok ? result.data : null).distinctExercises).toBe(2);
    });

    it('does not count a skipped zero-set occurrence as trained', async () => {
      const withSkipped = completedSession({
        id: 'session-skipped',
        scheduledWorkoutId: SCHED_A,
        workoutId: 'wo-a',
        startedAt: '2026-02-01T10:00:00Z',
        completedAt: '2026-02-01T11:00:00Z',
        occurrences: [
          // A skipped occurrence carries no logged set: it is not training.
          { authored: 'ex-005', isSkipped: true },
          { authored: 'ex-002', sets: [{ reps: 10, weightKg: 20 }] },
        ],
      });
      const { useCase } = await makeHarness({
        completedIds: [scheduledId(SCHED_A), scheduledId(SCHED_B)],
        sessions: [withSkipped, sessionB()],
        bestBefore: () => 1000,
        exercises: [makeExercise('ex-002')],
      });

      const result = await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

      // ex-002 only: had the skipped occurrence counted, this would be 2.
      expect(expectCompleted(result.ok ? result.data : null).distinctExercises).toBe(1);
    });
  });

  describe('historical PR events (M12 semantics)', () => {
    it('treats a first exposure as an event', async () => {
      const { useCase } = await makeHarness({
        completedIds: [scheduledId(SCHED_A), scheduledId(SCHED_B)],
        sessions: [sessionA(), sessionB()],
        // ex-001 has no eligible prior performance; ex-002 is suppressed.
        bestBefore: (candidate) => (candidate.exerciseId === 'ex-001' ? null : 1000),
        exercises: [makeExercise('ex-001'), makeExercise('ex-002')],
      });

      const result = await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

      const summary = expectCompleted(result.ok ? result.data : null);
      expect(summary.recordEventCount).toBe(1);
      expect(summary.recordEvents.map((event) => event.exerciseId)).toEqual(['ex-001']);
      expect(summary.recordEvents[0]?.previousBest).toBeNull();
    });

    it('treats a strictly greater performance as an event', async () => {
      const { useCase } = await makeHarness({
        completedIds: [scheduledId(SCHED_A), scheduledId(SCHED_B)],
        sessions: [sessionA(), sessionB()],
        // 40 kg strictly exceeds a 39 kg prior best.
        bestBefore: (candidate) => (candidate.exerciseId === 'ex-001' ? 39 : 1000),
        exercises: [makeExercise('ex-001'), makeExercise('ex-002')],
      });

      const result = await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

      const summary = expectCompleted(result.ok ? result.data : null);
      expect(summary.recordEventCount).toBe(1);
      expect(summary.recordEvents[0]?.value).toBe(40);
      expect(summary.recordEvents[0]?.previousBest).toBe(39);
    });

    it('does not treat an equal performance as an event', async () => {
      const { useCase } = await makeHarness({
        completedIds: [scheduledId(SCHED_A), scheduledId(SCHED_B)],
        sessions: [sessionA(), sessionB()],
        // An equal prior best (40 kg) never establishes a new record.
        bestBefore: (candidate) => (candidate.exerciseId === 'ex-001' ? 40 : 1000),
        exercises: [makeExercise('ex-001'), makeExercise('ex-002')],
      });

      const result = await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

      const summary = expectCompleted(result.ok ? result.data : null);
      expect(summary.recordEventCount).toBe(0);
      expect(summary.recordEvents).toEqual([]);
    });

    it('suppresses a false PR when a prior best exists in detached history', async () => {
      // The best-before read is user-global: a detached (left-program) session
      // is the user's training past and counts. Detachment itself is the
      // repository's concern (proven against real PostgreSQL in the
      // integration suite); here the stub answers as that read would.
      const { useCase } = await makeHarness({
        completedIds: [scheduledId(SCHED_A), scheduledId(SCHED_B)],
        sessions: [sessionA(), sessionB()],
        bestBefore: () => 100,
        exercises: [makeExercise('ex-001'), makeExercise('ex-002')],
      });

      const result = await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

      const summary = expectCompleted(result.ok ? result.data : null);
      expect(summary.recordEventCount).toBe(0);
    });

    it('suppresses a false PR when the prior best came from another program', async () => {
      const { useCase } = await makeHarness({
        completedIds: [scheduledId(SCHED_A), scheduledId(SCHED_B)],
        sessions: [sessionA(), sessionB()],
        // ex-002's prior best was earned elsewhere and is higher than this
        // run's 20 kg; ex-001 has no prior performance at all.
        bestBefore: (candidate) => (candidate.exerciseId === 'ex-002' ? 50 : null),
        exercises: [makeExercise('ex-001'), makeExercise('ex-002')],
      });

      const result = await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

      const summary = expectCompleted(result.ok ? result.data : null);
      // Only the genuine first exposure remains; the other program's prior best
      // suppressed only ex-002's false event.
      expect(summary.recordEventCount).toBe(1);
      expect(summary.recordEvents.map((event) => event.exerciseId)).toEqual(['ex-001']);
    });

    it('retains a run PR that was later surpassed within the run', async () => {
      const heavier = completedSession({
        id: 'session-heavier',
        scheduledWorkoutId: SCHED_B,
        workoutId: 'wo-b',
        startedAt: '2026-02-02T10:00:00Z',
        completedAt: '2026-02-02T11:00:00Z',
        occurrences: [{ authored: 'ex-001', sets: [{ reps: 5, weightKg: 45 }] }],
      });
      const { useCase } = await makeHarness({
        completedIds: [scheduledId(SCHED_A), scheduledId(SCHED_B)],
        // sessionA: ex-001 at 40 kg (first exposure), sessionB: 45 kg on top of it.
        sessions: [sessionA(), heavier],
        bestBefore: (candidate) => (candidate.value === 40 ? null : 40),
        exercises: [makeExercise('ex-001')],
      });

      const result = await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

      const summary = expectCompleted(result.ok ? result.data : null);
      // Historical semantics: both events happened, even though only the
      // heavier one still stands as a current best.
      expect(summary.recordEventCount).toBe(2);
      expect(summary.recordEvents.map((event) => event.value)).toEqual([45, 40]);
    });

    it('never uses the M13 current/still-standing best read', async () => {
      const { useCase, recordRepo } = await makeHarness({
        completedIds: [scheduledId(SCHED_A), scheduledId(SCHED_B)],
        sessions: [sessionA(), sessionB()],
        exercises: [makeExercise('ex-001'), makeExercise('ex-002')],
      });

      await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

      expect(recordRepo.findBestValuesBefore).toHaveBeenCalledTimes(1);
      expect(recordRepo.findCurrentPersonalBestsSetBetween).not.toHaveBeenCalled();
      expect(recordRepo.findCurrentPersonalBests).not.toHaveBeenCalled();
    });
  });

  describe('event counting, display cap and catalog metadata', () => {
    /** A run of seven logged sets: four ex-001 (41–44 kg) then three ex-002 (21–23 kg). */
    function sevenEventRun(): ReadonlyArray<CompletedWorkoutSession> {
      return [
        completedSession({
          id: 'session-four-sets',
          scheduledWorkoutId: SCHED_A,
          workoutId: 'wo-a',
          startedAt: '2026-02-01T10:00:00Z',
          completedAt: '2026-02-01T11:00:00Z',
          occurrences: [
            {
              authored: 'ex-001',
              sets: [
                { reps: 10, weightKg: 41 },
                { reps: 10, weightKg: 42 },
                { reps: 10, weightKg: 43 },
                { reps: 10, weightKg: 44 },
              ],
            },
          ],
        }),
        completedSession({
          id: 'session-three-sets',
          scheduledWorkoutId: SCHED_B,
          workoutId: 'wo-b',
          startedAt: '2026-02-02T10:00:00Z',
          completedAt: '2026-02-02T11:00:00Z',
          occurrences: [
            {
              authored: 'ex-002',
              sets: [
                { reps: 10, weightKg: 21 },
                { reps: 10, weightKg: 22 },
                { reps: 10, weightKg: 23 },
              ],
            },
          ],
        }),
      ];
    }

    it('keeps the exact count uncapped while capping the display list at the newest five', async () => {
      const { useCase } = await makeHarness({
        completedIds: [scheduledId(SCHED_A), scheduledId(SCHED_B)],
        sessions: sevenEventRun(),
        exercises: [makeExercise('ex-001'), makeExercise('ex-002')],
      });

      const result = await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

      const summary = expectCompleted(result.ok ? result.data : null);
      expect(summary.recordEventCount).toBe(7);
      expect(summary.recordEvents).toHaveLength(PROGRAM_COMPLETION_RECORD_EVENT_LIMIT);
      // Newest first: the three latest ex-002 sets, then the two latest ex-001.
      expect(summary.recordEvents.map((event) => event.value)).toEqual([23, 22, 21, 44, 43]);
      expect(summary.recordEvents.map((event) => event.exerciseId)).toEqual([
        'ex-002',
        'ex-002',
        'ex-002',
        'ex-001',
        'ex-001',
      ]);
    });

    it('resolves display metadata once, deduplicated, in display order', async () => {
      const { useCase, exerciseRepo } = await makeHarness({
        completedIds: [scheduledId(SCHED_A), scheduledId(SCHED_B)],
        sessions: sevenEventRun(),
        exercises: [makeExercise('ex-001'), makeExercise('ex-002')],
      });

      await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

      expect(exerciseRepo.findByIds).toHaveBeenCalledTimes(1);
      const requestedIds = exerciseRepo.findByIds.mock.calls[0]?.[0];
      expect(requestedIds).toEqual(['ex-002', 'ex-001']);
    });

    it('omits an unresolved display row, leaving the exact count unchanged', async () => {
      const { useCase } = await makeHarness({
        completedIds: [scheduledId(SCHED_A), scheduledId(SCHED_B)],
        sessions: sevenEventRun(),
        // ex-001 no longer resolves in the catalog.
        exercises: [makeExercise('ex-002')],
      });

      const result = await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

      const summary = expectCompleted(result.ok ? result.data : null);
      expect(summary.recordEventCount).toBe(7);
      expect(summary.recordEvents).toHaveLength(3);
      expect(summary.recordEvents.every((event) => event.exerciseId === 'ex-002')).toBe(true);
    });

    it('orders the newest events by the position ladder, breaking completedAt ties by startedAt', async () => {
      // Same completion instant: only the ladder's startedAt rung decides the
      // order, so a completedAt-only (stable) sort would keep the ascending
      // read order and fail this assertion.
      const earlierStart = completedSession({
        id: 'session-tie-early',
        scheduledWorkoutId: SCHED_A,
        workoutId: 'wo-a',
        startedAt: '2026-02-03T09:00:00Z',
        completedAt: '2026-02-03T11:00:00Z',
        occurrences: [{ authored: 'ex-002', sets: [{ reps: 10, weightKg: 20 }] }],
      });
      const laterStart = completedSession({
        id: 'session-tie-late',
        scheduledWorkoutId: SCHED_B,
        workoutId: 'wo-b',
        startedAt: '2026-02-03T10:00:00Z',
        completedAt: '2026-02-03T11:00:00Z',
        occurrences: [{ authored: 'ex-002', sets: [{ reps: 10, weightKg: 20 }] }],
      });
      const { useCase } = await makeHarness({
        completedIds: [scheduledId(SCHED_A), scheduledId(SCHED_B)],
        sessions: [earlierStart, laterStart],
        exercises: [makeExercise('ex-002')],
      });

      const result = await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

      const summary = expectCompleted(result.ok ? result.data : null);
      expect(summary.recordEvents.map((event) => event.sessionId)).toEqual([
        'session-tie-late',
        'session-tie-early',
      ]);
    });

    it('skips the best-before read entirely when the run has no candidates', async () => {
      // A persisted completed session with no set rows is unreachable through
      // the domain's completion gate, but reachable through legacy/externally
      // written rows, which the enrollment-scoped read returns defensively.
      const { useCase, recordRepo, exerciseRepo } = await makeHarness({
        completedIds: [scheduledId(SCHED_A), scheduledId(SCHED_B)],
        sessions: [setlessCompleted(sessionA()), setlessCompleted(sessionB())],
      });

      const result = await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

      const summary = expectCompleted(result.ok ? result.data : null);
      expect(recordRepo.findBestValuesBefore).not.toHaveBeenCalled();
      expect(summary.recordEventCount).toBe(0);
      expect(summary.recordEvents).toEqual([]);
      expect(summary.distinctExercises).toBe(0);
      expect(exerciseRepo.findByIds).not.toHaveBeenCalled();
    });

    it('propagates a record read failure instead of fabricating an empty summary', async () => {
      const { useCase } = await makeHarness({
        completedIds: [scheduledId(SCHED_A), scheduledId(SCHED_B)],
        sessions: [sessionA(), sessionB()],
        recordFailure: new Error('record read failed'),
      });

      await expect(
        useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG }),
      ).rejects.toThrow('record read failed');
    });
  });
});

/** Asserts the completed variant and narrows it for the caller. */
function expectCompleted(summary: ProgramCompletionSummaryDto | null): ProgramCompletionCompletedDto {
  expect(summary?.status).toBe('completed');
  if (summary === null || summary.status !== 'completed') {
    throw new Error('expected a completed completion summary');
  }
  return summary;
}

/**
 * A completed session whose occurrences carry no logged sets — the shape a
 * legacy or externally written row hydrates into. Unreachable through the
 * domain's completion gate (which requires at least one logged set); used to
 * pin the no-candidates shortcut defensively.
 */
function setlessCompleted(session: CompletedWorkoutSession): CompletedWorkoutSession {
  return {
    ...session,
    exerciseLogs: session.exerciseLogs.map((log) => ({ ...log, sets: [] })),
  };
}


