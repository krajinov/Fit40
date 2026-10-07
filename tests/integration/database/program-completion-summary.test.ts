/**
 * M14 Slice 4 — the completion summary over real PostgreSQL.
 *
 * Proves the complete pipeline end to end, not just the orchestration:
 * candidate origin is enrollment-scoped, its prior-best answers are
 * user-global (attached prior programs AND detached history), first-exposure /
 * strictly-greater / equal semantics hold exactly, a run PR that a later run
 * performance surpassed is still reported as a historical event, and M13's
 * current/still-standing-best read is NOT what the summary answers.
 *
 * The expected events come from the established Domain oracle:
 * `foldPersonalRecords` over the user's complete eligible history, then
 * filtered to the run's session ids. There is no second PR implementation in
 * this file and no M14-specific SQL.
 */

import { asc } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PROGRAM_COMPLETION_RECORD_EVENT_LIMIT } from '@/application/dto/program-completion';
import { GetProgramCompletionSummaryUseCase } from '@/application/use-cases/get-program-completion-summary';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import type { ScheduledWorkout, TrainingProgram } from '@/domain/entities/training-program';
import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import { comparePerformancePositions } from '@/domain/services/personal-record-metrics';
import { foldPersonalRecords } from '@/domain/services/personal-records';
import { skipSessionExercise } from '@/domain/services/session-exercise-skip';
import {
  createEnrollmentId,
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
  createWorkoutSessionId,
  type ExerciseId,
  type UserId,
} from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';
import { exercises } from '@/infrastructure/database/schema';

import { seedUser } from './personal-record-fixtures';
import {
  closeDatabase,
  db,
  exerciseRepository,
  personalRecordRepository,
  programEnrollmentRepository,
  programRepository,
  resetAndSeed,
  trainingHistoryRepository,
  workoutSessionRepository,
} from './setup';

const RUNNER = 'summary-runner';
const OTHER = 'summary-other';
const RUN_SLUG = 'strong-at-home';
const PRIOR_SLUG = 'fit40-beginner-strength';

const RUN_ENROLLMENT = 'enr-run';
const PRIOR_ENROLLMENT = 'enr-prior';
const OTHER_RUN_ENROLLMENT = 'enr-other-run';

function userIdValue(value: string): UserId {
  const result = createUserId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function exerciseId(value: string): ExerciseId {
  const result = createExerciseId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function enrollmentIdValue(value: string) {
  const result = createEnrollmentId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function scheduledWorkoutId(value: string) {
  const result = createScheduledWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function workoutIdValue(value: string) {
  const result = createWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function workoutSessionIdValue(value: string) {
  const result = createWorkoutSessionId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function repsScheme() {
  const result = createRepScheme(3, 8, 10);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** The program's scheduled occurrences in week/order sequence. */
function listOccurrences(program: TrainingProgram): ReadonlyArray<ScheduledWorkout> {
  return program.weeks.flatMap((week) =>
    [...week.scheduledWorkouts].sort((a, b) => a.order - b.order),
  );
}

function requireOccurrence(
  occurrences: ReadonlyArray<ScheduledWorkout>,
  index: number,
): ScheduledWorkout {
  const occurrence = occurrences[index];
  if (occurrence === undefined) {
    throw new Error(`Seed program is missing scheduled occurrence ${index}`);
  }
  return occurrence;
}

interface RunLogSpec {
  readonly exerciseId: string;
  readonly performedExerciseId?: string;
  readonly source?: 'user_added';
  readonly isSkipped?: boolean;
  readonly sets: ReadonlyArray<{ readonly reps: number; readonly weightKg: number | null }>;
}

/** Builds one session through the real domain factories and mutation services. */
function buildSession(spec: {
  readonly id: string;
  readonly owner: string;
  readonly enrollmentId: string | null;
  readonly occurrence: ScheduledWorkout;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly logs: ReadonlyArray<RunLogSpec>;
}): WorkoutSession {
  const created = createWorkoutSession({
    id: spec.id,
    userId: userIdValue(spec.owner),
    enrollmentId: spec.enrollmentId === null ? null : enrollmentIdValue(spec.enrollmentId),
    scheduledWorkoutId: scheduledWorkoutId(spec.occurrence.id),
    workoutId: workoutIdValue(spec.occurrence.workoutId),
    startedAt: new Date(spec.startedAt),
    exerciseLogs: spec.logs.map((log, index) => ({
      authoredExerciseId: exerciseId(log.exerciseId),
      order: index + 1,
      prescription: repsScheme(),
      restSeconds: 60,
      ...(log.performedExerciseId === undefined
        ? {}
        : { performedExerciseId: exerciseId(log.performedExerciseId) }),
      ...(log.source === undefined ? {} : { source: log.source }),
    })),
  });
  if (!created.ok) throw new Error(created.error.message);

  let session: WorkoutSession = created.data;
  for (const [index, log] of spec.logs.entries()) {
    for (const set of log.sets) {
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
    if (log.isSkipped === true) {
      const skipped = skipSessionExercise(session, { exerciseOrder: index + 1 });
      if (!skipped.ok) throw new Error(skipped.error.message);
      session = skipped.data;
    }
  }

  const done = completeWorkoutSession(session, new Date(spec.completedAt));
  if (!done.ok) throw new Error(done.error.message);
  return done.data;
}

async function enroll(
  id: string,
  owner: string,
  programId: string,
  enrolledAt: string,
): Promise<void> {
  const created = createProgramEnrollment({
    id,
    userId: owner,
    programId,
    enrolledAt: new Date(enrolledAt),
  });
  if (!created.ok) throw new Error(created.error.message);
  await programEnrollmentRepository.create(created.data);
}

/** The user's full completed history through the real history read port. */
async function hydrateCompletedHistory(ownerId: UserId): Promise<ReadonlyArray<WorkoutSession>> {
  const sessions: WorkoutSession[] = [];
  let after = null;
  for (;;) {
    const page = await trainingHistoryRepository.listCompletedSessions(ownerId, {
      limit: 50,
      after,
    });
    for (const entry of page.entries) {
      sessions.push(entry.session);
    }
    if (page.nextAfter === null) return sessions;
    after = page.nextAfter;
  }
}

interface PipelineHistory {
  readonly program: TrainingProgram;
  readonly priorProgramSlug: string;
  readonly exerciseA: ExerciseId;
  readonly exerciseB: ExerciseId;
  readonly exerciseC: ExerciseId;
  readonly runSessionIds: ReadonlyArray<string>;
  readonly priorSessionIds: ReadonlyArray<string>;
}

/**
 * Seeds the whole history: a prior program's ATTACHED session, a DETACHED
 * session, another user's far heavier noise, the other user's incomplete run,
 * and the runner's run — every scheduled workout of the program completed
 * inside its enrollment, one per day.
 */
async function seedPipelineHistory(): Promise<PipelineHistory> {
  await seedUser(RUNNER);
  await seedUser(OTHER);

  const program = await programRepository.findBySlug(RUN_SLUG);
  const priorProgram = await programRepository.findBySlug(PRIOR_SLUG);
  if (program === null || priorProgram === null) throw new Error('seeded programs are missing');

  // Real catalog ids: the exercise FKs are satisfied by rows the catalog holds.
  const catalog = await db
    .select({ id: exercises.id })
    .from(exercises)
    .orderBy(asc(exercises.id))
    .limit(4);
  const [exerciseA, exerciseB, exerciseC, exerciseD] = catalog.map((row) => exerciseId(row.id));
  if (
    exerciseA === undefined ||
    exerciseB === undefined ||
    exerciseC === undefined ||
    exerciseD === undefined
  ) {
    throw new Error('seeded exercise catalog is too small');
  }

  await enroll(RUN_ENROLLMENT, RUNNER, program.id, '2026-01-20T00:00:00Z');
  await enroll(PRIOR_ENROLLMENT, RUNNER, priorProgram.id, '2026-01-01T00:00:00Z');
  await enroll(OTHER_RUN_ENROLLMENT, OTHER, program.id, '2026-01-20T00:00:00Z');

  const priorOccurrences = listOccurrences(priorProgram);
  const priorOccurrence = requireOccurrence(priorOccurrences, 0);
  const detachedOccurrence = requireOccurrence(priorOccurrences, 1);

  // Prior history, before the run: one session attached to the earlier program...
  await workoutSessionRepository.save(
    buildSession({
      id: 'prior-attached',
      owner: RUNNER,
      enrollmentId: PRIOR_ENROLLMENT,
      occurrence: priorOccurrence,
      startedAt: '2026-01-05T09:00:00Z',
      completedAt: '2026-01-05T10:00:00Z',
      logs: [{ exerciseId: exerciseA, sets: [{ reps: 8, weightKg: 50 }] }],
    }),
  );
  // ...and one detached (leftover of a leave): the user's training past counts.
  await workoutSessionRepository.save(
    buildSession({
      id: 'prior-detached',
      owner: RUNNER,
      enrollmentId: null,
      occurrence: detachedOccurrence,
      startedAt: '2026-01-10T09:00:00Z',
      completedAt: '2026-01-10T10:00:00Z',
      logs: [{ exerciseId: exerciseC, sets: [{ reps: 8, weightKg: 60 }] }],
    }),
  );
  // Another user, far heavier: must never reach this user's reads.
  await workoutSessionRepository.save(
    buildSession({
      id: 'other-heavier',
      owner: OTHER,
      enrollmentId: null,
      occurrence: detachedOccurrence,
      startedAt: '2026-01-15T09:00:00Z',
      completedAt: '2026-01-15T10:00:00Z',
      logs: [{ exerciseId: exerciseA, sets: [{ reps: 8, weightKg: 999 }] }],
    }),
  );

  // The run: every scheduled workout completed, one per day, 2026-02-01..12.
  const runOccurrences = listOccurrences(program);
  const runPlans: ReadonlyArray<ReadonlyArray<RunLogSpec>> = [
    [{ exerciseId: exerciseA, sets: [{ reps: 8, weightKg: 50 }] }], // equal to the prior 50: no event
    [{ exerciseId: exerciseA, sets: [{ reps: 8, weightKg: 55 }] }], // strict improvement: event
    [{ exerciseId: exerciseB, sets: [{ reps: 8, weightKg: 30 }] }], // first exposure: event
    [{ exerciseId: exerciseC, sets: [{ reps: 8, weightKg: 55 }] }], // below the detached 60: no event
    [{ exerciseId: exerciseC, sets: [{ reps: 8, weightKg: 65 }] }], // strict improvement: event
    [
      // Substituted: authored A, performed B — the event belongs to B.
      { exerciseId: exerciseA, performedExerciseId: exerciseB, sets: [{ reps: 8, weightKg: 40 }] },
    ],
    [{ exerciseId: exerciseC, source: 'user_added', sets: [{ reps: 8, weightKg: 70 }] }],
    [{ exerciseId: exerciseA, sets: [{ reps: 8, weightKg: 60 }] }], // surpasses run-2's event
    [{ exerciseId: exerciseA, sets: [{ reps: 8, weightKg: 50 }] }], // lower: no event
    [
      { exerciseId: exerciseB, sets: [{ reps: 8, weightKg: 30 }] }, // equal: no event
      { exerciseId: exerciseD, isSkipped: true, sets: [] }, // skipped, set-less: not trained
    ],
    [{ exerciseId: exerciseA, sets: [{ reps: 8, weightKg: 45 }] }], // lower: no event
    [{ exerciseId: exerciseB, sets: [{ reps: 8, weightKg: 25 }] }], // lower: no event
  ];

  const runSessionIds: string[] = [];
  for (const [index, occurrence] of runOccurrences.entries()) {
    const id = `run-${index + 1}`;
    const day = String(index + 1).padStart(2, '0');
    await workoutSessionRepository.save(
      buildSession({
        id,
        owner: RUNNER,
        enrollmentId: RUN_ENROLLMENT,
        occurrence,
        startedAt: `2026-02-${day}T09:00:00Z`,
        completedAt: `2026-02-${day}T10:00:00Z`,
        logs: runPlans[index] ?? [],
      }),
    );
    runSessionIds.push(id);
  }

  // The other user's run: only its first scheduled workout completed.
  await workoutSessionRepository.save(
    buildSession({
      id: 'other-run-1',
      owner: OTHER,
      enrollmentId: OTHER_RUN_ENROLLMENT,
      occurrence: requireOccurrence(runOccurrences, 0),
      startedAt: '2026-02-01T09:00:00Z',
      completedAt: '2026-02-01T10:00:00Z',
      logs: [{ exerciseId: exerciseA, sets: [{ reps: 8, weightKg: 80 }] }],
    }),
  );

  return {
    program,
    priorProgramSlug: priorProgram.slug,
    exerciseA,
    exerciseB,
    exerciseC,
    runSessionIds,
    priorSessionIds: ['prior-attached', 'prior-detached'],
  };
}

function summaryUseCase() {
  return new GetProgramCompletionSummaryUseCase(
    programRepository,
    programEnrollmentRepository,
    workoutSessionRepository,
    personalRecordRepository,
    exerciseRepository,
  );
}

/** One comparable line per event, for exact oracle comparisons. */
interface EventLine {
  readonly exerciseId: string;
  readonly metric: string;
  readonly value: number;
  readonly previousBest: number | null;
}

function dtoEventLine(
  event: EventLine & { readonly sessionId: string },
): string {
  return `${event.exerciseId}/${event.metric}/${event.value}<-${event.previousBest ?? 'none'}@${event.sessionId}`;
}

function oracleEventLine(
  event: EventLine & { readonly position: { readonly sessionId: string } },
): string {
  return `${event.exerciseId}/${event.metric}/${event.value}<-${event.previousBest ?? 'none'}@${event.position.sessionId}`;
}

describe('program completion summary (M14 Slice 4) — PostgreSQL pipeline + M12 oracle', () => {
  let history: PipelineHistory;

  beforeEach(async () => {
    await resetAndSeed();
    history = await seedPipelineHistory();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("matches the Domain fold oracle for the run's historical PR events", async () => {
    const sessions = await hydrateCompletedHistory(userIdValue(RUNNER));
    const folded = foldPersonalRecords(sessions);
    if (!folded.ok) throw new Error(folded.error.message);

    const runIds = new Set(history.runSessionIds);
    const expectedRunEvents = folded.data.events.filter((event) =>
      runIds.has(event.position.sessionId),
    );
    const expectedDisplay = [...expectedRunEvents]
      .sort((a, b) => comparePerformancePositions(b.position, a.position))
      .slice(0, PROGRAM_COMPLETION_RECORD_EVENT_LIMIT);

    const result = await summaryUseCase().execute({ userId: RUNNER, programSlug: RUN_SLUG });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data?.status).toBe('completed');
    if (result.data === null || result.data.status !== 'completed') return;

    // A readable expectation alongside the oracle, so a mis-seeded fixture
    // cannot make both sides agree on the wrong history: the run's six events,
    // chronological, with their exact previous-best context.
    expect(expectedRunEvents.map(oracleEventLine)).toEqual([
      `${history.exerciseA}/max-load/55<-50@run-2`,
      `${history.exerciseB}/max-load/30<-none@run-3`,
      `${history.exerciseC}/max-load/65<-60@run-5`,
      `${history.exerciseB}/max-load/40<-30@run-6`,
      `${history.exerciseC}/max-load/70<-65@run-7`,
      `${history.exerciseA}/max-load/60<-55@run-8`,
    ]);

    // The exact count is the oracle's run-event count, and the display list is
    // exactly the newest five of them, newest first by the position ladder.
    expect(result.data.recordEventCount).toBe(expectedRunEvents.length);
    expect(result.data.recordEvents.map(dtoEventLine)).toEqual(expectedDisplay.map(oracleEventLine));

    // Enrollment scoping: the user's history ALSO produced real events before
    // this run (in the prior program and in detached history) — none of them
    // belongs to the summary, while the prior bests they establish DO suppress
    // false events inside the run (run-1's 50 kg equals the prior 50 kg, and
    // run-4's 55 kg sits below the detached 60 kg).
    const priorIds = new Set(history.priorSessionIds);
    const expectedPriorEvents = folded.data.events.filter((event) =>
      priorIds.has(event.position.sessionId),
    );
    expect(expectedPriorEvents.length).toBeGreaterThan(0);
    expect(result.data.recordEvents.every((event) => runIds.has(event.sessionId))).toBe(true);

    // Catalog identity is resolved for the rendered rows.
    expect(result.data.recordEvents.every((event) => event.exerciseName.length > 0)).toBe(true);
    expect(result.data.recordEvents.every((event) => event.exerciseSlug.length > 0)).toBe(true);
  });

  it('keeps a later-surpassed run PR in the exact count while the display cap drops it', async () => {
    const result = await summaryUseCase().execute({ userId: RUNNER, programSlug: RUN_SLUG });
    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null || result.data.status !== 'completed') return;

    // Six historical events happened; run-2's 55 kg was surpassed by run-8's
    // 60 kg and is therefore no current best — yet it stays an event of the run.
    expect(result.data.recordEventCount).toBe(6);
    expect(result.data.recordEvents).toHaveLength(PROGRAM_COMPLETION_RECORD_EVENT_LIMIT);
    expect(result.data.recordEvents.map((event) => event.sessionId)).toEqual([
      'run-8',
      'run-7',
      'run-6',
      'run-5',
      'run-3',
    ]);
    expect(result.data.recordEvents.some((event) => event.sessionId === 'run-2')).toBe(false);
  });

  it('answers historical run events, not M13 current still-standing bests', async () => {
    const currentBests = await personalRecordRepository.findCurrentPersonalBestsSetBetween(
      userIdValue(RUNNER),
      new Date('2026-02-01T00:00:00Z'),
      new Date('2026-02-13T00:00:00Z'),
    );
    const currentLoadBests = currentBests
      .filter((best) => best.exerciseId === history.exerciseA && best.metric === 'max-load')
      .map((best) => best.value);
    // M13 semantics: only the still-standing best (run-8's 60 kg) qualifies;
    // run-2's 55 kg is not a current best.
    expect(currentLoadBests).toEqual([60]);

    const result = await summaryUseCase().execute({ userId: RUNNER, programSlug: RUN_SLUG });
    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null || result.data.status !== 'completed') return;

    // The summary reports run-2's 55 kg as a historical event AND counts six
    // run events overall — the different question M14 must answer.
    expect(result.data.recordEventCount).toBe(6);
    const historical55 = await personalRecordRepository.findBestValuesBefore(
      userIdValue(RUNNER),
      [
        {
          exerciseId: history.exerciseA,
          metric: 'max-load',
          value: 55,
          position: {
            completedAt: new Date('2026-02-02T10:00:00Z'),
            startedAt: new Date('2026-02-02T09:00:00Z'),
            sessionId: workoutSessionIdValue('run-2'),
            exerciseOrder: 1,
            setNumber: 1,
          },
        },
      ],
    );
    // The event's context is the prior program's 50 kg — user-global history.
    expect(historical55.map((entry) => entry.bestBefore)).toEqual([50]);
  });

  it('reports the run completion instant, tallies and distinct trained exercises', async () => {
    const result = await summaryUseCase().execute({ userId: RUNNER, programSlug: RUN_SLUG });
    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null || result.data.status !== 'completed') return;

    const scheduledTotal = listOccurrences(history.program).length;
    expect(result.data.completedWorkouts).toBe(scheduledTotal);
    expect(result.data.totalWorkouts).toBe(scheduledTotal);
    // The last scheduled workout of the run completed on 2026-02-12.
    expect(result.data.completedAt).toBe('2026-02-12T10:00:00.000Z');
    // Performed identities with logged performance: A, B (also as the
    // substitution's performed id) and C. The skipped set-less fourth exercise
    // is not trained.
    expect(result.data.distinctExercises).toBe(3);
    expect(result.data.programSlug).toBe(RUN_SLUG);
    expect(result.data.programName.length).toBeGreaterThan(0);
  });

  it('separates not-enrolled, incomplete and completed outcomes for one program', async () => {
    const useCase = summaryUseCase();
    const scheduledTotal = listOccurrences(history.program).length;

    // The other user's run is its own state — never the runner's completion.
    const other = await useCase.execute({ userId: OTHER, programSlug: RUN_SLUG });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(other.data).toEqual({
      status: 'incomplete',
      completedWorkouts: 1,
      totalWorkouts: scheduledTotal,
    });

    // A program the other user is not enrolled in: the established null, with
    // no session or record read behind it.
    const notEnrolled = await useCase.execute({
      userId: OTHER,
      programSlug: history.priorProgramSlug,
    });
    expect(notEnrolled).toEqual({ ok: true, data: null });
  });
});

