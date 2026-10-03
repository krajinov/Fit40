/**
 * M17 Slice 10 — GetRunClosureSummaryUseCase.
 *
 * The read's contract: the denominator is the AUTHORED program (never calendar
 * rows, never M16's window, never user-global history), completion stays M14's
 * rule while conclusion additionally accepts an explicit not-performed record,
 * the open occurrences arrive in authored program order, and "no current
 * enrollment" is `null` rather than a fabricated summary. The repositories are
 * the real in-memory implementations, so enrollment scoping and detached
 * history behave exactly as production reads do.
 */

import { describe, expect, it, vi } from 'vitest';

import type { NotPerformedOccurrence } from '@/domain/entities/not-performed-occurrence';
import type { TrainingProgram } from '@/domain/entities/training-program';
import { GetRunClosureSummaryUseCase } from '@/application/use-cases/get-run-closure-summary';
import { InMemoryProgramEnrollmentRepository } from '@/infrastructure/enrollments/in-memory-program-enrollment-repository';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';

import {
  enrollment,
  enrollmentId,
  makeRunClosureFactsRepo,
  makeProgram,
  notPerformedFact,
  OCCURRENCES_IN_ORDER,
  OCCURRENCE_W1_1,
  OCCURRENCE_W1_2,
  OCCURRENCE_W1_3,
  OCCURRENCE_W2_1,
  OCCURRENCE_W2_2,
  OCCURRENCE_W2_3,
  PROGRAM_SLUG,
  saveCompletedSession,
} from './schedule-fixtures';

const PROGRAM = makeProgram();

const USER_A = 'user-a';
const USER_B = 'user-b';
const ENR_A = 'enr-a';
const ENR_B = 'enr-b';

async function makeHarness(
  options: {
    readonly enrolled?: boolean;
    /** Recorded facts; scoped by the port to the run that owns them. */
    readonly facts?: ReadonlyArray<NotPerformedOccurrence>;
    /** Occurrences completed in ENR_A. */
    readonly completed?: ReadonlyArray<string>;
    /** Occurrences completed by a DETACHED session (leave/restart history). */
    readonly detachedCompleted?: ReadonlyArray<string>;
    /** Occurrences completed in ENR_B (another user's run). */
    readonly otherRunCompleted?: ReadonlyArray<string>;
  } = {},
) {
  const enrollments = new InMemoryProgramEnrollmentRepository();
  const sessions = new InMemoryWorkoutSessionRepository();

  if (options.enrolled !== false) {
    await enrollments.create(enrollment(ENR_A, USER_A));
  }
  await enrollments.create(enrollment(ENR_B, USER_B));

  for (const occurrence of options.completed ?? []) {
    await saveCompletedSession(sessions, {
      id: `a-${occurrence}`,
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: occurrence,
    });
  }
  for (const occurrence of options.detachedCompleted ?? []) {
    await saveCompletedSession(sessions, {
      id: `d-${occurrence}`,
      userId: USER_A,
      enrollmentId: null,
      scheduledWorkoutId: occurrence,
    });
  }
  for (const occurrence of options.otherRunCompleted ?? []) {
    await saveCompletedSession(sessions, {
      id: `b-${occurrence}`,
      userId: USER_B,
      enrollmentId: enrollmentId(ENR_B),
      scheduledWorkoutId: occurrence,
    });
  }

  const closureFacts = makeRunClosureFactsRepo(sessions, options.facts ?? [], enrollments);
  const useCase = new GetRunClosureSummaryUseCase(enrollments, closureFacts);

  return { useCase, enrollments, sessions, closureFacts };
}

type Harness = Awaited<ReturnType<typeof makeHarness>>;

async function summarize(harness: Harness, program: TrainingProgram = PROGRAM) {
  const result = await harness.useCase.execute({ userId: USER_A, program });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** A program that authors no occurrence — unreachable through the factory. */
function makeZeroWorkoutProgram(): TrainingProgram {
  return {
    ...PROGRAM,
    weeks: PROGRAM.weeks.map((week) => ({ ...week, scheduledWorkouts: [] })),
  };
}

describe('GetRunClosureSummaryUseCase — the closure denominator', () => {
  it('never concludes a zero-workout program (locked convention)', async () => {
    const harness = await makeHarness();

    const summary = await summarize(harness, makeZeroWorkoutProgram());

    expect(summary).not.toBeNull();
    expect(summary).toMatchObject({
      programSlug: PROGRAM_SLUG,
      totalWorkouts: 0,
      completedWorkouts: 0,
      notPerformedWorkouts: 0,
      openWorkouts: 0,
      hasOpenWorkout: false,
      isConcluded: false,
      isProgramComplete: false,
      restartAvailable: false,
      openInProgramOrder: [],
    });
  });

  it('reports an all-open run as open: concluded false, zero counts, open = total', async () => {
    const harness = await makeHarness();

    const summary = await summarize(harness);

    expect(summary).toMatchObject({
      programSlug: PROGRAM_SLUG,
      totalWorkouts: 6,
      completedWorkouts: 0,
      notPerformedWorkouts: 0,
      openWorkouts: 6,
      hasOpenWorkout: true,
      isConcluded: false,
      isProgramComplete: false,
      restartAvailable: false,
    });
    expect(summary?.openInProgramOrder.map((open) => open.scheduledWorkoutId)).toEqual([
      ...OCCURRENCES_IN_ORDER,
    ]);
  });

  it('reports a fully completed run as concluded AND complete', async () => {
    const harness = await makeHarness({ completed: [...OCCURRENCES_IN_ORDER] });

    const summary = await summarize(harness);

    expect(summary).toMatchObject({
      totalWorkouts: 6,
      completedWorkouts: 6,
      notPerformedWorkouts: 0,
      openWorkouts: 0,
      hasOpenWorkout: false,
      isConcluded: true,
      isProgramComplete: true,
      restartAvailable: true,
    });
    expect(summary?.openInProgramOrder).toEqual([]);
  });

  it('counts recorded facts as settlement: completed + records cover every authored occurrence', async () => {
    const harness = await makeHarness({
      completed: [OCCURRENCE_W1_1, OCCURRENCE_W1_2, OCCURRENCE_W2_1, OCCURRENCE_W2_2],
      facts: [notPerformedFact(ENR_A, OCCURRENCE_W1_3), notPerformedFact(ENR_A, OCCURRENCE_W2_3)],
    });

    const summary = await summarize(harness);

    expect(summary).toMatchObject({
      totalWorkouts: 6,
      completedWorkouts: 4,
      notPerformedWorkouts: 2,
      openWorkouts: 0,
      isConcluded: true,
      // A concluded run may be INCOMPLETE: two authored occurrences have no
      // completed session, so M14's rule stays false — and never counts a record.
      isProgramComplete: false,
      restartAvailable: true,
    });
    expect(summary?.openInProgramOrder).toEqual([]);
  });

  it('stays open while one authored occurrence is unsettled', async () => {
    const harness = await makeHarness({
      completed: [OCCURRENCE_W1_1, OCCURRENCE_W1_2, OCCURRENCE_W2_1, OCCURRENCE_W2_2],
      facts: [notPerformedFact(ENR_A, OCCURRENCE_W1_3)],
    });

    const summary = await summarize(harness);

    expect(summary).toMatchObject({
      completedWorkouts: 4,
      notPerformedWorkouts: 1,
      openWorkouts: 1,
      hasOpenWorkout: true,
      isConcluded: false,
      isProgramComplete: false,
      restartAvailable: false,
    });
    expect(summary?.openInProgramOrder.map((open) => open.scheduledWorkoutId)).toEqual([
      OCCURRENCE_W2_3,
    ]);
  });
});

describe('GetRunClosureSummaryUseCase — ordering, labels and scoping', () => {
  it('returns the open occurrences in AUTHORED program order with their labels', async () => {
    // Facts and sessions are supplied out of authored order on purpose: the
    // order comes from the program, never from a repository read's ordering.
    const harness = await makeHarness({
      completed: [OCCURRENCE_W2_2, OCCURRENCE_W1_1],
      facts: [notPerformedFact(ENR_A, OCCURRENCE_W2_1), notPerformedFact(ENR_A, OCCURRENCE_W1_3)],
    });

    const summary = await summarize(harness);

    expect(summary?.openInProgramOrder).toEqual([
      {
        scheduledWorkoutId: OCCURRENCE_W1_2,
        weekNumber: 1,
        workoutOrder: 2,
        workoutName: 'Workout B',
      },
      {
        scheduledWorkoutId: OCCURRENCE_W2_3,
        weekNumber: 2,
        workoutOrder: 3,
        workoutName: 'Workout C',
      },
    ]);
  });

  it('ignores unknown ids in the counts (Slice 1 locked semantics)', async () => {
    const harness = await makeHarness({
      completed: [
        OCCURRENCE_W1_1,
        OCCURRENCE_W1_2,
        OCCURRENCE_W1_3,
        OCCURRENCE_W2_1,
        OCCURRENCE_W2_2,
        // An id the program does not author: ignored, never counted and never
        // able to settle the occurrence it does not name.
        'sched-unknown',
      ],
    });

    const summary = await summarize(harness);

    expect(summary).toMatchObject({
      totalWorkouts: 6,
      completedWorkouts: 5,
      openWorkouts: 1,
      isConcluded: false,
    });
    expect(summary?.openInProgramOrder.map((open) => open.scheduledWorkoutId)).toEqual([
      OCCURRENCE_W2_3,
    ]);
  });

  it('fails loudly when one authored occurrence is both completed and recorded', async () => {
    const harness = await makeHarness({
      completed: [OCCURRENCE_W1_1],
      facts: [notPerformedFact(ENR_A, OCCURRENCE_W1_1)],
    });

    await expect(harness.useCase.execute({ userId: USER_A, program: PROGRAM })).rejects.toThrow(
      'Run closure contract violated',
    );
  });

  it("never leaks another run's recorded facts into this run", async () => {
    const harness = await makeHarness({
      facts: OCCURRENCES_IN_ORDER.map((occurrence) => notPerformedFact(ENR_B, occurrence)),
    });

    const summary = await summarize(harness);

    expect(summary).toMatchObject({
      notPerformedWorkouts: 0,
      completedWorkouts: 0,
      openWorkouts: 6,
      isConcluded: false,
      isProgramComplete: false,
      restartAvailable: false,
    });
  });

  it('ignores detached and other-run sessions: only THIS run counts', async () => {
    const harness = await makeHarness({
      detachedCompleted: [...OCCURRENCES_IN_ORDER],
      otherRunCompleted: [...OCCURRENCES_IN_ORDER],
    });

    const summary = await summarize(harness);

    expect(summary).toMatchObject({
      completedWorkouts: 0,
      openWorkouts: 6,
      isConcluded: false,
      isProgramComplete: false,
      restartAvailable: false,
    });
  });
});

describe('GetRunClosureSummaryUseCase — ownership, reads and shape', () => {
  it('returns null and reads nothing when the user has no current run', async () => {
    const harness = await makeHarness({ enrolled: false });

    const result = await harness.useCase.execute({ userId: USER_A, program: PROGRAM });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBeNull();
    expect(harness.closureFacts.listClosureFactsByEnrollment).not.toHaveBeenCalled();
  });

  it('rejects a malformed userId without touching any repository', async () => {
    const harness = await makeHarness();
    const enrollmentRead = vi.spyOn(harness.enrollments, 'findByUserAndProgram');

    const result = await harness.useCase.execute({ userId: '   ', program: PROGRAM });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(enrollmentRead).not.toHaveBeenCalled();
  });

  it('reads exactly ONE coherent closure-facts projection — no hydration, no calendar', async () => {
    const harness = await makeHarness({
      completed: [OCCURRENCE_W1_1],
      facts: [notPerformedFact(ENR_A, OCCURRENCE_W1_2)],
    });
    const sessionsRead = vi.spyOn(harness.sessions, 'listCompletedByEnrollment');
    const activityRead = vi.spyOn(harness.sessions, 'listCompletedOccurrenceActivity');
    const inProgressRead = vi.spyOn(harness.sessions, 'listInProgressScheduledWorkoutIds');

    await summarize(harness);

    // ONE snapshot read supplies both fact sets — the use case never
    // coordinates two independently mutable reads.
    expect(harness.closureFacts.listClosureFactsByEnrollment).toHaveBeenCalledTimes(1);
    expect(harness.closureFacts.listClosureFactsByEnrollment).toHaveBeenCalledWith(enrollmentId(ENR_A));
    // No session aggregate, no record pipeline, no planning read at all.
    expect(sessionsRead).not.toHaveBeenCalled();
    expect(activityRead).not.toHaveBeenCalled();
    expect(inProgressRead).not.toHaveBeenCalled();
  });

  it('exposes exactly the locked DTO field set', async () => {
    const harness = await makeHarness({
      completed: [OCCURRENCE_W1_1],
      facts: [notPerformedFact(ENR_A, OCCURRENCE_W1_2)],
    });

    const summary = await summarize(harness);

    expect(summary).not.toBeNull();
    expect(Object.keys(summary ?? {})).toEqual([
      'programSlug',
      'totalWorkouts',
      'completedWorkouts',
      'notPerformedWorkouts',
      'openWorkouts',
      'hasOpenWorkout',
      'openInProgramOrder',
      'isConcluded',
      'isProgramComplete',
      'restartAvailable',
    ]);
  });
});

describe('GetRunClosureSummaryUseCase — enrollment identity fencing', () => {
  it('reads the closure of EXACTLY the expected enrollment when it is still current', async () => {
    const harness = await makeHarness({
      completed: [OCCURRENCE_W1_1],
      facts: [notPerformedFact(ENR_A, OCCURRENCE_W1_2)],
    });

    const result = await harness.useCase.execute({
      userId: USER_A,
      program: PROGRAM,
      expectedEnrollmentId: ENR_A,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      completedWorkouts: 1,
      notPerformedWorkouts: 1,
      // Four authored occurrences are still open, so the run is NOT concluded.
      isConcluded: false,
    });
  });

  it('refuses with ENROLLMENT_CHANGED when the expected enrollment was replaced, reading no facts', async () => {
    const harness = await makeHarness({ completed: [OCCURRENCE_W1_1] });
    // The replacement a restart produces: the old row is deleted and a
    // DIFFERENT id becomes the current run of the same (user, program) pair.
    await harness.enrollments.delete(enrollmentId(ENR_A));
    await harness.enrollments.create(enrollment('enr-a-replacement', USER_A));
    const fencedRead = harness.closureFacts.findFencedClosureFactsByEnrollment;

    const result = await harness.useCase.execute({
      userId: USER_A,
      program: PROGRAM,
      expectedEnrollmentId: ENR_A,
    });

    // The caller is composing an old-enrollment DTO: the fenced read refuses
    // rather than silently switching to the replacement run's facts.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: 'ENROLLMENT_CHANGED' });
    // Identity and facts are ONE statement: the fenced projection refused, and
    // no independent facts read was issued for the vanished enrollment.
    expect(fencedRead).toHaveBeenCalledTimes(1);
    expect(harness.closureFacts.listClosureFactsByEnrollment).not.toHaveBeenCalled();
  });

  it('refuses when the expected enrollment belongs to another user, reading no facts', async () => {
    const harness = await makeHarness();
    // ENR_B is a real, current enrollment — but it is USER_B's run.
    const fencedRead = harness.closureFacts.findFencedClosureFactsByEnrollment;

    const result = await harness.useCase.execute({
      userId: USER_A,
      program: PROGRAM,
      expectedEnrollmentId: ENR_B,
    });

    // The id alone never authorizes: ownership is verified in the SAME
    // statement as the facts, so a foreign run resolves not-matched.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: 'ENROLLMENT_CHANGED' });
    expect(fencedRead).toHaveBeenCalledTimes(1);
    expect(harness.closureFacts.listClosureFactsByEnrollment).not.toHaveBeenCalled();
  });

  it('keeps resolving the CURRENT enrollment when no expected id is supplied', async () => {
    const harness = await makeHarness({ completed: [OCCURRENCE_W1_1] });
    await harness.enrollments.delete(enrollmentId(ENR_A));
    await harness.enrollments.create(enrollment('enr-a-replacement', USER_A));
    await saveCompletedSession(harness.sessions, {
      id: 'r-occurrence',
      userId: USER_A,
      enrollmentId: enrollmentId('enr-a-replacement'),
      scheduledWorkoutId: OCCURRENCE_W1_2,
    });

    // The standalone convention is unchanged: without a fence the read
    // describes whichever run is current — here the replacement.
    const result = await harness.useCase.execute({ userId: USER_A, program: PROGRAM });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      completedWorkouts: 1,
      isConcluded: false,
    });
  });
});
