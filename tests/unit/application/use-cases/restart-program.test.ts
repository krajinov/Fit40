/**
 * M14 Slice 5 — RestartProgramUseCase orchestration.
 *
 * The enrollment repository is the real in-memory implementation (so the CAS
 * primitive behaves as Slice 3 defines it), the session/program ports are
 * stubs. These tests lock the application contract: the authoritative
 * completion gate, the single fresh-identity write, the typed mapping of every
 * expected state, the read-only stale re-check, and the absence of any second
 * write or retry.
 */

import { describe, expect, it, vi } from 'vitest';

import { EnrollmentAlreadyExistsError } from '@/application/ports/program-enrollment-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';
import { RestartProgramUseCase } from '@/application/use-cases/restart-program';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import type { NotPerformedOccurrence } from '@/domain/entities/not-performed-occurrence';
import { createTrainingProgram, type TrainingProgram } from '@/domain/entities/training-program';
import { createWorkout } from '@/domain/entities/workout';
import { Difficulty } from '@/domain/types/exercise';
import {
  createEnrollmentId,
  createExerciseId,
  createProgramId,
  createScheduledWorkoutId,
  createUserId,
  type EnrollmentId,
  type ScheduledWorkoutId,
} from '@/domain/types/ids';
import { ProgramGoal } from '@/domain/types/program';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';
import type { RunClosureFactsRepository } from '@/application/ports/run-closure-facts-repository';
import { InMemoryProgramEnrollmentRepository } from '@/infrastructure/enrollments/in-memory-program-enrollment-repository';

import { FakeIdGenerator } from '../../helpers/fake-crypto';

import { notPerformedFact } from './schedule-fixtures';

const PROGRAM_ID = 'p1';
const PROGRAM_SLUG = 'program-one';
const OLD_ENROLLMENT = 'enr-old';
const SCHED_A = 'sched-a';
const SCHED_B = 'sched-b';
const OLD_ENROLLED_AT = '2026-01-01T00:00:00Z';

function uid(value: string) {
  const result = createUserId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function pid(value: string) {
  const result = createProgramId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function enid(value: string) {
  const result = createEnrollmentId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function eid(value: string) {
  const result = createExerciseId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function scheduledId(value: string) {
  const result = createScheduledWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function allScheduledIds(): ReadonlyArray<ScheduledWorkoutId> {
  return [scheduledId(SCHED_A), scheduledId(SCHED_B)];
}

function repScheme() {
  const result = createRepScheme(3, 8, 10);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** A one-week program with two scheduled workouts. */
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

/**
 * A zero-schedule program. Unreachable through the factory (every week must
 * carry its scheduled occurrences), constructed structurally to pin the locked
 * M14 semantics: `isProgramComplete` reports it as NOT complete, so it can
 * never be restarted.
 */
function makeZeroScheduleProgram(): TrainingProgram {
  const program = makeProgram();
  return {
    ...program,
    weeks: program.weeks.map((week) => ({ ...week, scheduledWorkouts: [] })),
  };
}

function makeProgramRepo(program: TrainingProgram | null) {
  return {
    list: vi.fn(),
    findBySlug: vi.fn(async () => program),
    findSessionRouteByScheduledWorkoutId: vi.fn(),
    listMetadataByIds: vi.fn(),
  } satisfies ProgramRepository;
}

/**
 * The preflight's ONE-snapshot closure-facts stub: completed and recorded ids
 * keyed per enrollment, exactly like the port. The same shape feeds the
 * replacement's own locked re-check through `setRunSettlementFacts`.
 */
function makeClosureFactsRepo(
  completedByEnrollment: Record<string, ReadonlyArray<ScheduledWorkoutId>>,
  notPerformedFacts: ReadonlyArray<NotPerformedOccurrence> = [],
) {
  return {
    listClosureFactsByEnrollment: vi.fn(async (enrollmentId: EnrollmentId) => ({
      completedIds: completedByEnrollment[enrollmentId] ?? [],
      notPerformedIds: notPerformedFacts
        .filter((fact) => fact.enrollmentId === enrollmentId)
        .map((fact) => fact.scheduledWorkoutId),
    })),
  } satisfies RunClosureFactsRepository;
}

async function makeHarness(
  options: {
    readonly program?: TrainingProgram | null;
    readonly enrolled?: boolean;
    readonly completedByEnrollment?: Record<string, ReadonlyArray<ScheduledWorkoutId>>;
    /** Recorded not-performed facts of the CURRENT (old) run. */
    readonly notPerformedFacts?: ReadonlyArray<NotPerformedOccurrence>;
  } = {},
) {
  const programRepo = makeProgramRepo(
    options.program === undefined ? makeProgram() : options.program,
  );
  const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
  if (options.enrolled !== false) {
    const created = createProgramEnrollment({
      id: OLD_ENROLLMENT,
      userId: 'user-a',
      programId: PROGRAM_ID,
      enrolledAt: new Date(OLD_ENROLLED_AT),
    });
    if (!created.ok) throw new Error(created.error.message);
    await enrollmentRepo.create(created.data);
  }
  const closureFacts = makeClosureFactsRepo(
    options.completedByEnrollment ?? {},
    options.notPerformedFacts ?? [],
  );

  return {
    useCase: new RestartProgramUseCase(
      programRepo,
      enrollmentRepo,
      closureFacts,
      new FakeIdGenerator(),
    ),
    programRepo,
    enrollmentRepo,
    closureFacts,
  };
}

/**
 * Simulates the outcome of a concurrent restart: the expected enrollment is
 * replaced by a different identity. The completed ids of the replacement are
 * keyed by its own id, so completeness is never inferred from identity.
 */
async function seedReplacementEnrollment(
  repo: InMemoryProgramEnrollmentRepository,
  completedByEnrollment: Record<string, ReadonlyArray<ScheduledWorkoutId>>,
  replacementId: string,
  replacementCompletedIds: ReadonlyArray<ScheduledWorkoutId> = [],
): Promise<void> {
  const created = createProgramEnrollment({
    id: replacementId,
    userId: 'user-a',
    programId: PROGRAM_ID,
    enrolledAt: new Date('2026-02-01T00:00:00Z'),
  });
  if (!created.ok) throw new Error(created.error.message);
  await repo.delete(enid(OLD_ENROLLMENT));
  await repo.create(created.data);
  completedByEnrollment[replacementId] = replacementCompletedIds;
}

describe('RestartProgramUseCase — inputs and current state', () => {
  it('reports INVALID_ENROLLMENT for a malformed userId without touching any repository', async () => {
    const { useCase, programRepo, closureFacts } = await makeHarness();

    const result = await useCase.execute({ userId: '   ', programSlug: PROGRAM_SLUG });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_ENROLLMENT');
    expect(programRepo.findBySlug).not.toHaveBeenCalled();
    expect(closureFacts.listClosureFactsByEnrollment).not.toHaveBeenCalled();
  });

  it('reports PROGRAM_NOT_FOUND for an unknown program', async () => {
    const { useCase, closureFacts } = await makeHarness({ program: null });

    const result = await useCase.execute({ userId: 'user-a', programSlug: 'missing' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROGRAM_NOT_FOUND');
    expect(closureFacts.listClosureFactsByEnrollment).not.toHaveBeenCalled();
  });

  it('reports NOT_ENROLLED when the user has no enrollment for the program', async () => {
    const { useCase, enrollmentRepo, closureFacts } = await makeHarness({ enrolled: false });
    const replaceSpy = vi.spyOn(enrollmentRepo, 'replaceExpectedWithNew');

    const result = await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_ENROLLED');
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(closureFacts.listClosureFactsByEnrollment).not.toHaveBeenCalled();
  });

  it('reports PROGRAM_NOT_COMPLETE when the current run is incomplete', async () => {
    const { useCase } = await makeHarness({
      completedByEnrollment: { [OLD_ENROLLMENT]: [scheduledId(SCHED_A)] },
    });

    const result = await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROGRAM_NOT_COMPLETE');
  });

  it('never calls replaceExpectedWithNew for an incomplete run', async () => {
    const { useCase, enrollmentRepo } = await makeHarness({
      completedByEnrollment: { [OLD_ENROLLMENT]: [scheduledId(SCHED_A)] },
    });
    const replaceSpy = vi.spyOn(enrollmentRepo, 'replaceExpectedWithNew');

    await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('refuses to restart a zero-schedule program (locked semantics)', async () => {
    const { useCase, enrollmentRepo } = await makeHarness({
      program: makeZeroScheduleProgram(),
      // Even a (structurally impossible) claim of completions cannot make an
      // empty schedule complete.
      completedByEnrollment: { [OLD_ENROLLMENT]: allScheduledIds() },
    });
    const replaceSpy = vi.spyOn(enrollmentRepo, 'replaceExpectedWithNew');

    const result = await useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROGRAM_NOT_COMPLETE');
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it("does not restart another user's completed enrollment", async () => {
    const { useCase, enrollmentRepo } = await makeHarness({
      completedByEnrollment: { [OLD_ENROLLMENT]: allScheduledIds() },
    });
    const replaceSpy = vi.spyOn(enrollmentRepo, 'replaceExpectedWithNew');

    const result = await useCase.execute({ userId: 'user-b', programSlug: PROGRAM_SLUG });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_ENROLLED');
    expect(replaceSpy).not.toHaveBeenCalled();

    // Owner A's enrollment is exactly as it was.
    const owned = await enrollmentRepo.findByUserAndProgram(uid('user-a'), pid(PROGRAM_ID));
    expect(owned?.id).toBe(OLD_ENROLLMENT);
    expect(owned?.enrolledAt.toISOString()).toBe(new Date(OLD_ENROLLED_AT).toISOString());
  });
});

describe('RestartProgramUseCase — the replacement', () => {
  it('replaces the completed enrollment with a fresh identity exactly once', async () => {
    const harness = await makeHarness({
      completedByEnrollment: { [OLD_ENROLLMENT]: allScheduledIds() },
    });
    const replaceSpy = vi.spyOn(harness.enrollmentRepo, 'replaceExpectedWithNew');
    const createSpy = vi.spyOn(harness.enrollmentRepo, 'create');
    const deleteSpy = vi.spyOn(harness.enrollmentRepo, 'delete');

    const before = Date.now();
    const result = await harness.useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });
    const after = Date.now();

    expect(result.ok).toBe(true);

    // Exactly one CAS, keyed on the enrollment this use case loaded.
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    const call = replaceSpy.mock.calls[0];
    expect(call?.[0]).toBe(OLD_ENROLLMENT);
    const fresh = call?.[1];
    expect(fresh?.id).toBe('fake-id-1');
    expect(fresh?.userId).toBe('user-a');
    expect(fresh?.programId).toBe(PROGRAM_ID);
    // The fresh enrollment is stamped with the current instant.
    expect(fresh?.enrolledAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(fresh?.enrolledAt.getTime()).toBeLessThanOrEqual(after);
    expect(fresh?.enrolledAt.toISOString()).not.toBe(new Date(OLD_ENROLLED_AT).toISOString());

    // No separate create/delete composition, and no post-success write.
    expect(createSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();

    const owned = await harness.enrollmentRepo.findByUserAndProgram(uid('user-a'), pid(PROGRAM_ID));
    expect(owned?.id).toBe('fake-id-1');
  });

  it('never reuses the old enrollment identity', async () => {
    const harness = await makeHarness({
      completedByEnrollment: { [OLD_ENROLLMENT]: allScheduledIds() },
    });

    const result = await harness.useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

    expect(result.ok).toBe(true);
    const owned = await harness.enrollmentRepo.findByUserAndProgram(uid('user-a'), pid(PROGRAM_ID));
    expect(owned?.id).toBe('fake-id-1');
    expect(owned?.id).not.toBe(OLD_ENROLLMENT);
    // The old row is gone: addressing it again finds nothing.
    expect(await harness.enrollmentRepo.delete(enid(OLD_ENROLLMENT))).toBe(false);
  });

  it('maps a duplicate-enrollment race to ALREADY_ENROLLED without retrying', async () => {
    const harness = await makeHarness({
      completedByEnrollment: { [OLD_ENROLLMENT]: allScheduledIds() },
    });
    const replaceSpy = vi
      .spyOn(harness.enrollmentRepo, 'replaceExpectedWithNew')
      .mockRejectedValue(new EnrollmentAlreadyExistsError('user-a', PROGRAM_ID));

    const result = await harness.useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ALREADY_ENROLLED');
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    // The rolled-back transaction left the old enrollment in place.
    const owned = await harness.enrollmentRepo.findByUserAndProgram(uid('user-a'), pid(PROGRAM_ID));
    expect(owned?.id).toBe(OLD_ENROLLMENT);
  });

  it('propagates an unexpected repository failure', async () => {
    const harness = await makeHarness({
      completedByEnrollment: { [OLD_ENROLLMENT]: allScheduledIds() },
    });
    vi.spyOn(harness.enrollmentRepo, 'replaceExpectedWithNew').mockRejectedValue(
      new Error('database unavailable'),
    );

    await expect(
      harness.useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG }),
    ).rejects.toThrow('database unavailable');
  });

  it('reports NOT_ENROLLED when a stale CAS finds no enrollment', async () => {
    const harness = await makeHarness({
      completedByEnrollment: { [OLD_ENROLLMENT]: allScheduledIds() },
    });
    // A concurrent leave removes the row AFTER the gate read it, so the CAS
    // finds nothing to replace and the use case reports the stale outcome.
    const replaceSpy = vi
      .spyOn(harness.enrollmentRepo, 'replaceExpectedWithNew')
      .mockImplementation(async () => {
        await harness.enrollmentRepo.delete(enid(OLD_ENROLLMENT));
        return { kind: 'stale' };
      });

    const result = await harness.useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_ENROLLED');
    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });

  it('reports PROGRAM_NOT_COMPLETE when a stale CAS finds a fresh unstarted run', async () => {
    const completed: Record<string, ReadonlyArray<ScheduledWorkoutId>> = {
      [OLD_ENROLLMENT]: allScheduledIds(),
    };
    const harness = await makeHarness({ completedByEnrollment: completed });
    // A concurrent restart swaps in a fresh, unstarted run AFTER the gate read
    // the completed one, so the CAS reports the stale outcome.
    const replaceSpy = vi
      .spyOn(harness.enrollmentRepo, 'replaceExpectedWithNew')
      .mockImplementation(async () => {
        await seedReplacementEnrollment(harness.enrollmentRepo, completed, 'enr-fresh');
        return { kind: 'stale' };
      });

    const result = await harness.useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROGRAM_NOT_COMPLETE');
    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });

  it('reports ENROLLMENT_CHANGED when a stale CAS finds another completed enrollment', async () => {
    const completed: Record<string, ReadonlyArray<ScheduledWorkoutId>> = {
      [OLD_ENROLLMENT]: allScheduledIds(),
    };
    const harness = await makeHarness({ completedByEnrollment: completed });
    // The state moves again AFTER the gate: a different, also-complete
    // enrollment is current when the CAS reports the stale outcome.
    const replaceSpy = vi
      .spyOn(harness.enrollmentRepo, 'replaceExpectedWithNew')
      .mockImplementation(async () => {
        await seedReplacementEnrollment(
          harness.enrollmentRepo,
          completed,
          'enr-fresh-again',
          allScheduledIds(),
        );
        return { kind: 'stale' };
      });

    const result = await harness.useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ENROLLMENT_CHANGED');
    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });

  it('performs no second write after a stale CAS', async () => {
    const harness = await makeHarness({
      completedByEnrollment: { [OLD_ENROLLMENT]: allScheduledIds() },
    });
    // Synthetic stale CAS: the primitive reports the expected id gone while the
    // store still holds it, so the read-only re-check maps the outcome. The
    // real interleavings are covered by the PostgreSQL suite.
    const replaceSpy = vi
      .spyOn(harness.enrollmentRepo, 'replaceExpectedWithNew')
      .mockResolvedValue({ kind: 'stale' });
    const createSpy = vi.spyOn(harness.enrollmentRepo, 'create');
    const deleteSpy = vi.spyOn(harness.enrollmentRepo, 'delete');

    const result = await harness.useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The still-present enrollment is complete, so the truth-based mapping says
    // the state moved rather than that the run is incomplete.
    expect(result.error.code).toBe('ENROLLMENT_CHANGED');
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

/**
 * M17 Slice 10 — the gate widens from "complete" to "complete OR concluded".
 *
 * The Domain decides both (`isRunConcluded` over the authored program,
 * `isRunRestartable` over the two verdicts); these tests pin the Application
 * contract around it: WHICH settled runs may restart, that the eligibility
 * read is enrollment-scoped, that no date or calendar enters the gate, and
 * that the write path — one compare-and-replace — is untouched.
 */
describe('RestartProgramUseCase — M17 Slice 10 restartability', () => {
  it('restarts a concluded-but-incomplete run exactly once (no second write)', async () => {
    const harness = await makeHarness({
      completedByEnrollment: { [OLD_ENROLLMENT]: [scheduledId(SCHED_A)] },
      notPerformedFacts: [notPerformedFact(OLD_ENROLLMENT, SCHED_B)],
    });
    const replaceSpy = vi.spyOn(harness.enrollmentRepo, 'replaceExpectedWithNew');
    const createSpy = vi.spyOn(harness.enrollmentRepo, 'create');
    const deleteSpy = vi.spyOn(harness.enrollmentRepo, 'delete');

    const result = await harness.useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

    // Restarted although the program is NOT complete: the record settles the
    // second authored occurrence, so the run is concluded.
    expect(result.ok).toBe(true);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy.mock.calls[0]?.[0]).toBe(OLD_ENROLLMENT);
    // The write discipline is byte-identical to M14: one CAS, no composition.
    expect(createSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();

    const owned = await harness.enrollmentRepo.findByUserAndProgram(uid('user-a'), pid(PROGRAM_ID));
    expect(owned?.id).toBe('fake-id-1');
  });

  it('restarts a run settled ENTIRELY by recorded facts (no completed session)', async () => {
    // Rowless by construction: this use case has no planned-workout port at
    // all, so the records settle their occurrences with no calendar row and no
    // date anywhere in the eligibility read.
    const harness = await makeHarness({
      completedByEnrollment: { [OLD_ENROLLMENT]: [] },
      notPerformedFacts: [
        notPerformedFact(OLD_ENROLLMENT, SCHED_A),
        notPerformedFact(OLD_ENROLLMENT, SCHED_B),
      ],
    });
    const replaceSpy = vi.spyOn(harness.enrollmentRepo, 'replaceExpectedWithNew');

    const result = await harness.useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

    expect(result.ok).toBe(true);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });

  it('never consults a date: a record attested in the future still settles its occurrence', async () => {
    const harness = await makeHarness({
      completedByEnrollment: { [OLD_ENROLLMENT]: [scheduledId(SCHED_A)] },
      // The attestation instant is deliberately beyond any plausible horizon —
      // the gate reads no clock, no planned row and no date, so conclusion
      // (and therefore restartability) cannot be a date consequence.
      notPerformedFacts: [notPerformedFact(OLD_ENROLLMENT, SCHED_B, '2027-06-01T00:00:00.000Z')],
    });

    const result = await harness.useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

    expect(result.ok).toBe(true);
  });

  it('reads execution truth through ONE coherent closure-facts snapshot, exactly once', async () => {
    const harness = await makeHarness({
      completedByEnrollment: { [OLD_ENROLLMENT]: [scheduledId(SCHED_A)] },
      notPerformedFacts: [notPerformedFact(OLD_ENROLLMENT, SCHED_B)],
    });

    await harness.useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

    // The preflight reads the SAME one-snapshot projection the summary read
    // uses — never two independently mutable settlement reads.
    expect(harness.closureFacts.listClosureFactsByEnrollment).toHaveBeenCalledTimes(1);
    expect(harness.closureFacts.listClosureFactsByEnrollment).toHaveBeenCalledWith(
      enid(OLD_ENROLLMENT),
    );
  });

  it('hands the replacement a decision that re-evaluates the Domain rule over the locked facts', async () => {
    const harness = await makeHarness({
      completedByEnrollment: { [OLD_ENROLLMENT]: [scheduledId(SCHED_A)] },
      notPerformedFacts: [notPerformedFact(OLD_ENROLLMENT, SCHED_B)],
    });
    const replaceSpy = vi.spyOn(harness.enrollmentRepo, 'replaceExpectedWithNew');

    const result = await harness.useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });
    expect(result.ok).toBe(true);

    // The third argument is a DECISION, not a constant: the same Domain rule
    // must answer for the facts it is handed under the write's authority.
    const decision = replaceSpy.mock.calls[0]?.[2];
    expect(typeof decision).toBe('function');
    // Settled facts (A completed, B recorded) → restartable.
    expect(
      decision?.({ completedIds: [scheduledId(SCHED_A)], notPerformedIds: [scheduledId(SCHED_B)] }),
    ).toBe(true);
    // The SAME facts minus the record leave B open → not restartable. This is
    // exactly the state Undo produces before the replacement acquires authority.
    expect(decision?.({ completedIds: [scheduledId(SCHED_A)], notPerformedIds: [] })).toBe(false);
  });

  it('maps a replacement refused under its own authority (run reopened) to PROGRAM_NOT_COMPLETE, zero writes', async () => {
    const harness = await makeHarness({
      completedByEnrollment: { [OLD_ENROLLMENT]: [scheduledId(SCHED_A)] },
      notPerformedFacts: [notPerformedFact(OLD_ENROLLMENT, SCHED_B)],
    });
    // The pre-read saw a settled run, but by the time the replacement took
    // authority an Undo had reopened it, so the primitive refuses with ZERO
    // writes. The real interleaving is proven by the PostgreSQL race suite.
    const replaceSpy = vi
      .spyOn(harness.enrollmentRepo, 'replaceExpectedWithNew')
      .mockResolvedValue({ kind: 'not-restartable' });
    const createSpy = vi.spyOn(harness.enrollmentRepo, 'create');
    const deleteSpy = vi.spyOn(harness.enrollmentRepo, 'delete');

    const result = await harness.useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROGRAM_NOT_COMPLETE');
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    // No second write and no stale re-check side effects: the refusal is final.
    expect(createSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    // The old enrollment is still the current one.
    const owned = await harness.enrollmentRepo.findByUserAndProgram(uid('user-a'), pid(PROGRAM_ID));
    expect(owned?.id).toBe(OLD_ENROLLMENT);
  });

  it('refuses an open run with PROGRAM_NOT_COMPLETE and writes nothing', async () => {
    const harness = await makeHarness({
      // SCHED_B is open: one completed plus one open is neither complete nor
      // concluded, so the existing error stays reachable.
      completedByEnrollment: { [OLD_ENROLLMENT]: [scheduledId(SCHED_A)] },
    });
    const replaceSpy = vi.spyOn(harness.enrollmentRepo, 'replaceExpectedWithNew');

    const result = await harness.useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROGRAM_NOT_COMPLETE');
    expect(replaceSpy).not.toHaveBeenCalled();
    // The gate still reads the facts — it needs them to know the run is open.
    expect(harness.closureFacts.listClosureFactsByEnrollment).toHaveBeenCalledTimes(1);
  });

  it("ignores another run's recorded facts: the gate is enrollment-scoped", async () => {
    const harness = await makeHarness({
      completedByEnrollment: { [OLD_ENROLLMENT]: [scheduledId(SCHED_A)] },
      notPerformedFacts: [notPerformedFact('enr-other', SCHED_B)],
    });

    const result = await harness.useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROGRAM_NOT_COMPLETE');
  });

  it('reads no execution truth for a visitor without a run', async () => {
    const harness = await makeHarness({ enrolled: false });

    await harness.useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

    expect(harness.closureFacts.listClosureFactsByEnrollment).not.toHaveBeenCalled();
  });

  it('maps a stale CAS that finds a concluded-but-incomplete replacement to ENROLLMENT_CHANGED', async () => {
    const completed: Record<string, ReadonlyArray<ScheduledWorkoutId>> = {
      [OLD_ENROLLMENT]: [scheduledId(SCHED_A)],
    };
    const harness = await makeHarness({
      completedByEnrollment: completed,
      notPerformedFacts: [
        notPerformedFact(OLD_ENROLLMENT, SCHED_B),
        // The replacement run is itself concluded-but-incomplete, so the
        // read-only re-check must reach ENROLLMENT_CHANGED through the SAME
        // widened rule — never PROGRAM_NOT_COMPLETE for a settled run.
        notPerformedFact('enr-fresh-again', SCHED_B),
      ],
    });
    const replaceSpy = vi
      .spyOn(harness.enrollmentRepo, 'replaceExpectedWithNew')
      .mockImplementation(async () => {
        await seedReplacementEnrollment(
          harness.enrollmentRepo,
          completed,
          'enr-fresh-again',
          [scheduledId(SCHED_A)],
        );
        return { kind: 'stale' };
      });

    const result = await harness.useCase.execute({ userId: 'user-a', programSlug: PROGRAM_SLUG });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ENROLLMENT_CHANGED');
    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });
});


