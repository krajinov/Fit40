import { describe, expect, it, vi } from 'vitest';

import {
  toConfiguredFollowThroughDto,
  type ConfiguredFollowThroughDto,
  type EnrollmentFollowThroughDto,
} from '@/application/dto/follow-through';
import {
  FOLLOW_THROUGH_WEEK_COUNT,
  GetEnrollmentFollowThroughUseCase,
} from '@/application/use-cases/get-enrollment-follow-through';
import type { PlannedWorkout } from '@/domain/entities/planned-workout';
import type { NotPerformedOccurrence } from '@/domain/entities/not-performed-occurrence';
import type { FollowThroughSummary } from '@/domain/services/follow-through-week';
import { InMemoryProgramEnrollmentRepository } from '@/infrastructure/enrollments/in-memory-program-enrollment-repository';
import { InMemoryPlannedWorkoutRepository } from '@/infrastructure/scheduling/in-memory-planned-workout-repository';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';

import {
  enrollment,
  enrollmentId,
  LAST_FRI,
  LAST_WED,
  makeFollowThroughExecutionFactsRepo,
  makeNotPerformedRepo,
  makeProgram,
  MON,
  notPerformedFact,
  NOW,
  OCCURRENCE_W1_1,
  OCCURRENCE_W1_2,
  OCCURRENCE_W1_3,
  OCCURRENCE_W2_1,
  OCCURRENCE_W2_2,
  OCCURRENCE_W2_3,
  planned,
  plannedDate,
  PROGRAM_SLUG,
  saveCompletedSession,
  saveInProgressSession,
  scheduledWorkoutId,
  THU,
  TUE,
  WED,
} from './schedule-fixtures';

const PROGRAM = makeProgram();

const USER_A = 'user-a';
const ENR_A = 'enr-a';
const USER_B = 'user-b';
const ENR_B = 'enr-b';

function makeHarness(facts: ReadonlyArray<NotPerformedOccurrence> = []) {
  const enrollments = new InMemoryProgramEnrollmentRepository();
  const plannedWorkouts = new InMemoryPlannedWorkoutRepository();
  const sessions = new InMemoryWorkoutSessionRepository();
  const notPerformed = makeNotPerformedRepo(facts);
  const executionFacts = makeFollowThroughExecutionFactsRepo(sessions, facts, enrollments, plannedWorkouts);
  const useCase = new GetEnrollmentFollowThroughUseCase(
    enrollments,
    plannedWorkouts,
    executionFacts,
    notPerformed,
  );
  return { enrollments, plannedWorkouts, sessions, executionFacts, notPerformed, useCase };
}

type Harness = ReturnType<typeof makeHarness>;

async function enrolledRun(harness: Harness, id = ENR_A, owner = USER_A): Promise<void> {
  await harness.enrollments.create(enrollment(id, owner));
}

/** Gives the run a calendar: the planned rows are its current intent. */
async function configure(
  harness: Harness,
  rows: ReadonlyArray<PlannedWorkout>,
  id = ENR_A,
): Promise<void> {
  await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(id), rows);
}

/** Runs the read and asserts it succeeded, returning the DTO (or null). */
async function readFollowThrough(
  harness: Harness,
  userId = USER_A,
): Promise<EnrollmentFollowThroughDto | null> {
  const result = await harness.useCase.execute({ userId, program: PROGRAM, now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** Runs the read and asserts a configured report came back. */
async function readConfigured(harness: Harness): Promise<ConfiguredFollowThroughDto> {
  const dto = await readFollowThrough(harness);
  if (dto === null || !dto.configured) {
    throw new Error('expected a configured follow-through report');
  }
  return dto;
}

describe('GetEnrollmentFollowThroughUseCase', () => {
  it('rejects an invalid user id without reading anything', async () => {
    const harness = makeHarness();
    const enrollmentRead = vi.spyOn(harness.enrollments, 'findByUserAndProgram');

    const result = await harness.useCase.execute({ userId: '  ', program: PROGRAM, now: NOW });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: 'INVALID_INPUT', field: 'userId' });
    expect(enrollmentRead).not.toHaveBeenCalled();
  });

  it('returns null when the user is not enrolled, reading no planning or session facts', async () => {
    const harness = makeHarness();
    const plannedRead = vi.spyOn(harness.plannedWorkouts, 'listByEnrollment');
    const completedRead = vi.spyOn(harness.sessions, 'listCompletedOccurrenceActivity');
    const inProgressRead = vi.spyOn(harness.sessions, 'listInProgressScheduledWorkoutIds');

    expect(await readFollowThrough(harness)).toBeNull();

    expect(plannedRead).not.toHaveBeenCalled();
    expect(completedRead).not.toHaveBeenCalled();
    expect(inProgressRead).not.toHaveBeenCalled();
  });

  it('returns null for a run of another program or another user, reading no facts', async () => {
    const harness = makeHarness();
    // Another user's configured run of the same program, and this user's run of
    // a different program: neither is this user's run of this program.
    await enrolledRun(harness, ENR_B, USER_B);
    await configure(harness, [planned(ENR_B, OCCURRENCE_W1_1, MON)], ENR_B);
    await harness.enrollments.create(enrollment('enr-other-program', USER_A, 'p-other'));

    const plannedRead = vi.spyOn(harness.plannedWorkouts, 'listByEnrollment');
    const completedRead = vi.spyOn(harness.sessions, 'listCompletedOccurrenceActivity');

    expect(await readFollowThrough(harness)).toBeNull();

    expect(plannedRead).not.toHaveBeenCalled();
    expect(completedRead).not.toHaveBeenCalled();
  });

  it('reports an unconfigured run without fabricating weeks or reading sessions', async () => {
    const harness = makeHarness();
    await enrolledRun(harness);
    const plannedRead = vi.spyOn(harness.plannedWorkouts, 'listByEnrollment');
    const completedRead = vi.spyOn(harness.sessions, 'listCompletedOccurrenceActivity');
    const inProgressRead = vi.spyOn(harness.sessions, 'listInProgressScheduledWorkoutIds');

    const dto = await readFollowThrough(harness);

    // No zero week and no zero totals ship for a run with no calendar: the
    // unconfigured variant carries neither. It DOES carry the factual unplaced
    // count, which is zero here because the run has no recorded facts at all.
    expect(dto).toEqual({
      programSlug: PROGRAM_SLUG,
      today: MON,
      configured: false,
      notPerformedUnplaced: 0,
    });
    expect(dto !== null && 'weeks' in dto).toBe(false);
    expect(dto !== null && 'totals' in dto).toBe(false);
    // The planned rows had to be read to learn that. The fact read IS issued
    // (every recorded fact would be unplaced with zero rows) but the session
    // reads could not change any count, so they are not issued.
    expect(plannedRead).toHaveBeenCalledTimes(1);
    expect(harness.notPerformed.listByEnrollment).toHaveBeenCalledTimes(1);
    expect(completedRead).not.toHaveBeenCalled();
    expect(inProgressRead).not.toHaveBeenCalled();
  });

  it('assembles one planned occurrence per row from intent and session facts', async () => {
    const harness = makeHarness();
    await enrolledRun(harness);
    // Six authored occurrences, one planned row each, in two reported weeks:
    // the previous week (completed on plan + past due) and the current one
    // (completed early, live, completed late, upcoming).
    await configure(harness, [
      planned(ENR_A, OCCURRENCE_W1_1, LAST_WED),
      planned(ENR_A, OCCURRENCE_W2_3, LAST_FRI),
      planned(ENR_A, OCCURRENCE_W1_2, MON),
      planned(ENR_A, OCCURRENCE_W1_3, TUE),
      planned(ENR_A, OCCURRENCE_W2_1, WED),
      planned(ENR_A, OCCURRENCE_W2_2, THU),
    ]);
    await saveCompletedSession(harness.sessions, {
      id: 'sess-on-plan',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W1_1,
      workoutId: 'wo-a',
      startedAt: '2026-09-16T08:00:00Z',
      completedAt: '2026-09-16T09:30:00Z',
    });
    await saveCompletedSession(harness.sessions, {
      id: 'sess-early',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W1_2,
      workoutId: 'wo-b',
      startedAt: '2026-09-19T08:00:00Z',
      completedAt: '2026-09-19T09:00:00Z',
    });
    await saveCompletedSession(harness.sessions, {
      id: 'sess-late',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W2_1,
      workoutId: 'wo-a',
      startedAt: '2026-09-24T08:00:00Z',
      completedAt: '2026-09-24T09:00:00Z',
    });
    await saveInProgressSession(harness.sessions, {
      id: 'sess-live',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W1_3,
      workoutId: 'wo-c',
      startedAt: '2026-09-22T08:00:00Z',
    });

    const dto = await readConfigured(harness);

    // The report maps exactly, and carries nothing beyond the locked shape: no
    // enrollment id, no session id, no score or percentage field.
    expect(Object.keys(dto)).toEqual([
      'programSlug',
      'today',
      'configured',
      'weeks',
      'totals',
      'notPerformedUnplaced',
    ]);
    expect(dto.programSlug).toBe(PROGRAM_SLUG);
    expect(dto.today).toBe(MON);
    expect(dto.weeks).toHaveLength(2);
    expect(dto.weeks[0]).toEqual({
      weekStart: '2026-09-14T00:00:00.000Z',
      weekEnd: '2026-09-21T00:00:00.000Z',
      closed: true,
      planned: 2,
      completed: 1,
      completedEarly: 0,
      completedLate: 0,
      started: 0,
      pastDue: 1,
      notPerformed: 0,
    });
    expect(dto.weeks[1]).toEqual({
      weekStart: '2026-09-21T00:00:00.000Z',
      weekEnd: '2026-09-28T00:00:00.000Z',
      closed: false,
      planned: 4,
      completed: 2,
      completedEarly: 1,
      completedLate: 1,
      started: 1,
      pastDue: 0,
      notPerformed: 0,
    });
    expect(dto.totals).toEqual({
      planned: 6,
      completed: 3,
      completedEarly: 1,
      completedLate: 1,
      started: 1,
      pastDue: 1,
      notPerformed: 0,
    });
  });

  it('counts an occurrence as completed when a live fact arrives with it', async () => {
    const harness = makeHarness();
    await enrolledRun(harness);
    await configure(harness, [planned(ENR_A, OCCURRENCE_W1_1, MON)]);
    // The database admits one session per (enrollment, occurrence), so this pair
    // cannot come from storage; the assembly must still resolve it by the locked
    // precedence — a completion outranks a live session — rather than by luck.
    vi.spyOn(harness.sessions, 'listCompletedOccurrenceActivity').mockResolvedValue([
      {
        scheduledWorkoutId: scheduledWorkoutId(OCCURRENCE_W1_1),
        completedAt: new Date('2026-09-21T09:00:00Z'),
      },
    ]);
    vi.spyOn(harness.sessions, 'listInProgressScheduledWorkoutIds').mockResolvedValue([
      scheduledWorkoutId(OCCURRENCE_W1_1),
    ]);

    const dto = await readConfigured(harness);

    expect(dto.weeks[0]).toMatchObject({
      planned: 1,
      completed: 1,
      completedEarly: 0,
      completedLate: 0,
      started: 0,
      pastDue: 0,
    });
  });

  it('ignores activity whose occurrence has no current planned row', async () => {
    const harness = makeHarness();
    await enrolledRun(harness);
    await configure(harness, [planned(ENR_A, OCCURRENCE_W1_1, MON)]);
    // Realistic: an occurrence completed, and another started, before this run's
    // calendar was configured — so neither has a planned row today.
    await saveCompletedSession(harness.sessions, {
      id: 'sess-unplanned',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W2_1,
      startedAt: '2026-09-10T08:00:00Z',
      completedAt: '2026-09-10T09:00:00Z',
    });
    await saveInProgressSession(harness.sessions, {
      id: 'sess-unplanned-live',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W2_2,
      startedAt: '2026-09-20T08:00:00Z',
    });

    // Both facts are stored and read …
    expect(await harness.sessions.listCompletedOccurrenceActivity(enrollmentId(ENR_A))).toHaveLength(1);
    expect(
      await harness.sessions.listInProgressScheduledWorkoutIds(enrollmentId(ENR_A)),
    ).toHaveLength(1);

    const dto = await readConfigured(harness);

    // … but they never create a report occurrence and never reach the totals:
    // only the current planned row is reported.
    expect(dto.weeks).toHaveLength(1);
    expect(dto.totals).toEqual({
      planned: 1,
      completed: 0,
      completedEarly: 0,
      completedLate: 0,
      started: 0,
      pastDue: 0,
      notPerformed: 0,
    });
  });

  it('reports only the last 8 UTC weeks, ignoring older planned rows', async () => {
    const harness = makeHarness();
    await enrolledRun(harness);
    await configure(harness, [
      planned(ENR_A, OCCURRENCE_W1_1, '2026-08-04'),
      planned(ENR_A, OCCURRENCE_W1_2, '2026-08-05'),
      planned(ENR_A, OCCURRENCE_W1_3, '2026-08-06'),
      // The Monday before the oldest reported window: outside the horizon.
      planned(ENR_A, OCCURRENCE_W2_1, '2026-07-28'),
      planned(ENR_A, OCCURRENCE_W2_2, LAST_WED),
      planned(ENR_A, OCCURRENCE_W2_3, MON),
    ]);

    const dto = await readConfigured(harness);

    expect(FOLLOW_THROUGH_WEEK_COUNT).toBe(8);
    // Only windows holding a planned row are reported: oldest first, Monday to
    // Monday, with the current week still open.
    expect(dto.weeks.map((week) => week.weekStart)).toEqual([
      '2026-08-03T00:00:00.000Z',
      '2026-09-14T00:00:00.000Z',
      '2026-09-21T00:00:00.000Z',
    ]);
    expect(dto.weeks.map((week) => week.weekEnd)).toEqual([
      '2026-08-10T00:00:00.000Z',
      '2026-09-21T00:00:00.000Z',
      '2026-09-28T00:00:00.000Z',
    ]);
    expect(dto.weeks.map((week) => week.closed)).toEqual([true, true, false]);
    // Five of the six rows are inside the horizon; the older one is reported
    // nowhere — not as a week and not in the totals.
    expect(dto.totals.planned).toBe(5);
    expect(dto.weeks.map((week) => week.planned)).toEqual([3, 1, 1]);
  });

  it('issues exactly ONE snapshot read for every execution fact of the configured path', async () => {
    const harness = makeHarness();
    await enrolledRun(harness);
    await configure(harness, [planned(ENR_A, OCCURRENCE_W1_1, MON)]);
    const plannedRead = vi.spyOn(harness.plannedWorkouts, 'listByEnrollment');
    const snapshotRead = harness.executionFacts.listFollowThroughExecutionFactsByEnrollment;

    await readConfigured(harness);

    // ONE coherent snapshot supplies completed activity, in-progress sessions
    // and the recorded facts — the use case never coordinates two independently
    // mutable reads that could tear across a settlement transition.
    expect(snapshotRead).toHaveBeenCalledTimes(1);
    expect(snapshotRead).toHaveBeenCalledWith(enrollmentId(ENR_A));
    expect(plannedRead).toHaveBeenCalledTimes(1);
  });

  it('never invokes a repository write', async () => {
    const harness = makeHarness();
    await enrolledRun(harness);
    await configure(harness, [planned(ENR_A, OCCURRENCE_W1_1, MON)]);
    await saveCompletedSession(harness.sessions, {
      id: 'sess-read-only',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W1_1,
      startedAt: '2026-09-21T08:00:00Z',
      completedAt: '2026-09-21T09:00:00Z',
    });

    // Spies are installed after the fixture writes, so only the read counts.
    const writes = [
      vi.spyOn(harness.enrollments, 'create'),
      vi.spyOn(harness.enrollments, 'delete'),
      vi.spyOn(harness.enrollments, 'replaceExpectedWithNew'),
      vi.spyOn(harness.plannedWorkouts, 'replaceAllForEnrollment'),
      vi.spyOn(harness.plannedWorkouts, 'reschedule'),
      vi.spyOn(harness.sessions, 'save'),
    ];

    await readConfigured(harness);

    for (const write of writes) {
      expect(write).not.toHaveBeenCalled();
    }
  });

  it('propagates a failed read instead of reporting an unconfigured run', async () => {
    const harness = makeHarness();
    await enrolledRun(harness);
    await configure(harness, [planned(ENR_A, OCCURRENCE_W1_1, MON)]);

    vi.spyOn(harness.sessions, 'listCompletedOccurrenceActivity').mockRejectedValue(
      new Error('activity store unavailable'),
    );
    await expect(
      harness.useCase.execute({ userId: USER_A, program: PROGRAM, now: NOW }),
    ).rejects.toThrow('activity store unavailable');

    vi.restoreAllMocks();
    vi.spyOn(harness.plannedWorkouts, 'listByEnrollment').mockRejectedValue(
      new Error('planning store unavailable'),
    );
    await expect(
      harness.useCase.execute({ userId: USER_A, program: PROGRAM, now: NOW }),
    ).rejects.toThrow('planning store unavailable');
  });

  it('maps the Domain summary verbatim, recomputing nothing', () => {
    // A deliberately self-inconsistent summary: one completion is early while
    // `completed` is zero, and the totals are not the sum of the week. The mapper
    // must copy it exactly — "repairing" it would be the Application re-deciding
    // Domain semantics.
    const summary: FollowThroughSummary = {
      weeks: [
        {
          window: {
            weekStart: new Date('2026-09-14T00:00:00.000Z'),
            weekEnd: new Date('2026-09-21T00:00:00.000Z'),
            weekIndex: -1,
          },
          closed: true,
          planned: 2,
          completed: 0,
          completedEarly: 1,
          completedLate: 0,
          started: 0,
          pastDue: 2,
          notPerformed: 0,
        },
      ],
      totals: {
        planned: 9,
        completed: 9,
        completedEarly: 9,
        completedLate: 9,
        started: 9,
        pastDue: 9,
        notPerformed: 0,
      },
    };

    const dto = toConfiguredFollowThroughDto(PROGRAM_SLUG, plannedDate(MON), summary, 0);

    expect(dto.weeks[0]).toEqual({
      weekStart: '2026-09-14T00:00:00.000Z',
      weekEnd: '2026-09-21T00:00:00.000Z',
      closed: true,
      planned: 2,
      completed: 0,
      completedEarly: 1,
      completedLate: 0,
      started: 0,
      pastDue: 2,
      notPerformed: 0,
    });
    // Every counter this DTO carries is copied verbatim (the deliberately
    // inconsistent 9s must survive, including the M17 `notPerformed` one).
    expect(dto.totals).toEqual({
      planned: 9,
      completed: 9,
      completedEarly: 9,
      completedLate: 9,
      started: 9,
      pastDue: 9,
      notPerformed: 0,
    });
  });

/**
 * M17 Slice 9 — recorded not-performed facts in the M16 report.
 *
 * The three locked buckets, and the horizon that must not move:
 * 1. a recorded fact whose planned row is inside the reported weeks is that row's
 *    outcome (`not-performed`, counted as planned AND as not performed);
 * 2. a recorded fact whose planned row is OUTSIDE the weeks changes nothing at
 *    all — and is still a placed occurrence, so it is not counted as unplaced;
 * 3. a recorded fact with NO planned row is reported only as
 *    `notPerformedUnplaced`, a count that never reaches a week or a total.
 */
describe('GetEnrollmentFollowThroughUseCase — recorded not-performed facts (Slice 9)', () => {
  it('reports an in-horizon recorded occurrence as not performed, still planned', async () => {
    const harness = makeHarness([
      notPerformedFact(ENR_A, OCCURRENCE_W1_1),
      notPerformedFact(ENR_A, OCCURRENCE_W1_2),
    ]);
    await enrolledRun(harness);
    // A recorded occurrence already behind (previous week), one recorded for
    // today, and one unrecorded occurrence later this week.
    await configure(harness, [
      planned(ENR_A, OCCURRENCE_W1_1, LAST_WED),
      planned(ENR_A, OCCURRENCE_W1_2, MON),
      planned(ENR_A, OCCURRENCE_W1_3, THU),
    ]);

    const dto = await readConfigured(harness);

    // The locked 8-week windows, oldest first, with no extra week: a fact changed
    // no window and no ordering.
    expect(dto.weeks[0]).toEqual({
      weekStart: '2026-09-14T00:00:00.000Z',
      weekEnd: '2026-09-21T00:00:00.000Z',
      closed: true,
      planned: 1,
      completed: 0,
      completedEarly: 0,
      completedLate: 0,
      started: 0,
      // A recorded day is settled, not behind.
      pastDue: 0,
      notPerformed: 1,
    });
    expect(dto.weeks[1]).toEqual({
      weekStart: '2026-09-21T00:00:00.000Z',
      weekEnd: '2026-09-28T00:00:00.000Z',
      closed: false,
      // Both current-week rows are planned; only the recorded one is not performed.
      planned: 2,
      completed: 0,
      completedEarly: 0,
      completedLate: 0,
      started: 0,
      pastDue: 0,
      notPerformed: 1,
    });
    expect(dto.totals).toEqual({
      planned: 3,
      completed: 0,
      completedEarly: 0,
      completedLate: 0,
      started: 0,
      pastDue: 0,
      notPerformed: 2,
    });
    // Both facts have rows, so nothing is unplaced.
    expect(dto.notPerformedUnplaced).toBe(0);
  });

  it('keeps a live session ahead of the record, the locked precedence', async () => {
    const harness = makeHarness([notPerformedFact(ENR_A, OCCURRENCE_W1_1)]);
    await enrolledRun(harness);
    await configure(harness, [planned(ENR_A, OCCURRENCE_W1_1, LAST_WED)]);
    await saveInProgressSession(harness.sessions, {
      id: 'sess-live-recorded',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W1_1,
      workoutId: 'wo-a',
      startedAt: '2026-09-16T08:00:00Z',
    });

    const dto = await readConfigured(harness);

    // Work happening now is never relabelled by a record.
    expect(dto.weeks[0]).toMatchObject({
      planned: 1,
      started: 1,
      pastDue: 0,
      completed: 0,
      notPerformed: 0,
    });
    expect(dto.notPerformedUnplaced).toBe(0);
  });

});

  it('fails loudly when one occurrence is both completed and recorded', async () => {
    const harness = makeHarness([notPerformedFact(ENR_A, OCCURRENCE_W1_1)]);
    await enrolledRun(harness);
    await configure(harness, [planned(ENR_A, OCCURRENCE_W1_1, LAST_WED)]);
    await saveCompletedSession(harness.sessions, {
      id: 'sess-completed-and-recorded',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W1_1,
      workoutId: 'wo-a',
      startedAt: '2026-09-16T08:00:00Z',
      completedAt: '2026-09-16T09:00:00Z',
    });

    // The Slice 2 invariant is enforced on this path too: no precedence could be
    // honest, so the contradiction throws instead of reporting a number that
    // matches neither source.
    await expect(readFollowThrough(harness)).rejects.toThrow(
      /Occurrence settlement contract violated/,
    );
  });

  it('ignores a recorded fact whose planned row lies outside the horizon', async () => {
    const rows: ReadonlyArray<PlannedWorkout> = [
      // The next week: outside the 8 reported weeks, exactly as before M17.
      planned(ENR_A, OCCURRENCE_W2_1, '2026-09-30'),
      planned(ENR_A, OCCURRENCE_W1_1, MON),
    ];
    const withFact = makeHarness([notPerformedFact(ENR_A, OCCURRENCE_W2_1)]);
    await enrolledRun(withFact);
    await configure(withFact, rows);
    const withoutFact = makeHarness();
    await enrolledRun(withoutFact);
    await configure(withoutFact, rows);

    const dto = await readConfigured(withFact);
    const baseline = await readConfigured(withoutFact);

    // The fact pulls nothing into the report: the out-of-horizon row still has no
    // week and no total, and the report is identical to the same run without the
    // record.
    expect(dto.weeks).toEqual(baseline.weeks);
    expect(dto.totals).toEqual(baseline.totals);
    expect(dto.weeks).toHaveLength(1);
    expect(dto.weeks[0]).toMatchObject({ planned: 1, notPerformed: 0 });
    expect(dto.totals.planned).toBe(1);
    expect(dto.totals.notPerformed).toBe(0);
    // Load-bearing: the row EXISTS, so the occurrence is placed — unplaced means
    // "no current planned row", never "not represented by a reported week".
    expect(dto.notPerformedUnplaced).toBe(0);
  });

  it('reports a recorded fact with no planned row as a count only', async () => {
    const harness = makeHarness([notPerformedFact(ENR_A, OCCURRENCE_W2_2)]);
    await enrolledRun(harness);
    await configure(harness, [planned(ENR_A, OCCURRENCE_W1_1, MON)]);

    const dto = await readConfigured(harness);

    // No synthetic occurrence: one row in, one row reported, no fabricated week.
    expect(dto.weeks).toHaveLength(1);
    expect(dto.weeks[0]).toMatchObject({ planned: 1, notPerformed: 0 });
    expect(dto.totals).toEqual({
      planned: 1,
      completed: 0,
      completedEarly: 0,
      completedLate: 0,
      started: 0,
      pastDue: 0,
      notPerformed: 0,
    });
    expect(dto.notPerformedUnplaced).toBe(1);
  });

  it('keeps the three buckets distinct in one report', async () => {
    const harness = makeHarness([
      notPerformedFact(ENR_A, OCCURRENCE_W1_1),
      notPerformedFact(ENR_A, OCCURRENCE_W2_1),
      notPerformedFact(ENR_A, OCCURRENCE_W2_2),
    ]);
    await enrolledRun(harness);
    await configure(harness, [
      // Bucket 1: in horizon, recorded.
      planned(ENR_A, OCCURRENCE_W1_1, LAST_WED),
      // Bucket 2: out of horizon, recorded.
      planned(ENR_A, OCCURRENCE_W2_1, '2026-09-30'),
      // In horizon, not recorded.
      planned(ENR_A, OCCURRENCE_W1_2, MON),
    ]);

    const dto = await readConfigured(harness);

    expect(dto.weeks).toHaveLength(2);
    expect(dto.weeks[0]).toMatchObject({ planned: 1, notPerformed: 1 });
    expect(dto.weeks[1]).toMatchObject({ planned: 1, notPerformed: 0 });
    expect(dto.totals.planned).toBe(2);
    expect(dto.totals.notPerformed).toBe(1);
    // Only the rowless fact is unplaced: the out-of-horizon occurrence has a row.
    expect(dto.notPerformedUnplaced).toBe(1);
  });

  it('never appends a rowless fact as an occurrence, and reads the facts once', async () => {
    const rows: ReadonlyArray<PlannedWorkout> = [
      planned(ENR_A, OCCURRENCE_W1_1, LAST_WED),
      planned(ENR_A, OCCURRENCE_W1_2, MON),
    ];
    const orphans = makeHarness([
      notPerformedFact(ENR_A, OCCURRENCE_W2_1),
      notPerformedFact(ENR_A, OCCURRENCE_W2_2),
      notPerformedFact(ENR_A, OCCURRENCE_W2_3),
    ]);
    await enrolledRun(orphans);
    await configure(orphans, rows);
    const plain = makeHarness();
    await enrolledRun(plain);
    await configure(plain, rows);
    const factsRead = orphans.executionFacts.listFollowThroughExecutionFactsByEnrollment;

    const dto = await readConfigured(orphans);
    const baseline = await readConfigured(plain);

    // The spine is the current planned rows: three rowless facts cannot add a
    // week, a planned count or a weekly not-performed count.
    expect(dto.weeks).toEqual(baseline.weeks);
    expect(dto.totals).toEqual(baseline.totals);
    expect(dto.notPerformedUnplaced).toBe(3);
    // One bounded, enrollment-scoped snapshot read supplies every execution
    // fact — never one query per row or fact, never two mutable reads.
    expect(factsRead).toHaveBeenCalledTimes(1);
    expect(factsRead).toHaveBeenCalledWith(enrollmentId(ENR_A));
  });

  it('counts one recorded occurrence once when a fact is repeated', async () => {
    const harness = makeHarness([
      notPerformedFact(ENR_A, OCCURRENCE_W1_1),
      notPerformedFact(ENR_A, OCCURRENCE_W1_1, '2026-09-25T18:30:00.000Z'),
    ]);
    await enrolledRun(harness);
    await configure(harness, [planned(ENR_A, OCCURRENCE_W1_1, LAST_WED)]);

    const dto = await readConfigured(harness);

    // `(enrollment, occurrence)` is the fact's key, so a repeat is one recorded
    // occurrence: neither the week nor the unplaced count doubles.
    expect(dto.weeks[0]?.notPerformed).toBe(1);
    expect(dto.totals.notPerformed).toBe(1);
    expect(dto.notPerformedUnplaced).toBe(0);
  });

  it("does not leak another run's recorded facts", async () => {
    const harness = makeHarness([notPerformedFact(ENR_B, OCCURRENCE_W2_2)]);
    await enrolledRun(harness);
    await enrolledRun(harness, ENR_B, USER_B);
    await configure(harness, [planned(ENR_A, OCCURRENCE_W1_1, MON)]);
    await configure(harness, [planned(ENR_B, OCCURRENCE_W1_1, MON)], ENR_B);

    const mine = await readConfigured(harness);
    expect(mine.notPerformedUnplaced).toBe(0);

    const theirs = await readFollowThrough(harness, USER_B);
    expect(theirs !== null && theirs.configured).toBe(true);
    if (theirs === null || !theirs.configured) return;
    expect(theirs.notPerformedUnplaced).toBe(1);
  });

  it('reports rowless recorded facts for a run with no planned rows, still unconfigured', async () => {
    // Slice 9 correction: with ZERO planned rows every recorded fact is
    // unplaced, so the count is factual run truth even though the run has no
    // calendar to report on. No week and no total is fabricated.
    const harness = makeHarness([
      notPerformedFact(ENR_A, OCCURRENCE_W1_1),
      notPerformedFact(ENR_A, OCCURRENCE_W2_1),
      notPerformedFact(ENR_A, OCCURRENCE_W2_3),
    ]);
    await enrolledRun(harness);
    const factsRead = vi.spyOn(harness.notPerformed, 'listByEnrollment');
    const completedRead = vi.spyOn(harness.sessions, 'listCompletedOccurrenceActivity');
    const inProgressRead = vi.spyOn(harness.sessions, 'listInProgressScheduledWorkoutIds');

    const dto = await readFollowThrough(harness);

    expect(dto).toEqual({
      programSlug: PROGRAM_SLUG,
      today: MON,
      configured: false,
      notPerformedUnplaced: 3,
    });
    expect(dto !== null && 'weeks' in dto).toBe(false);
    expect(dto !== null && 'totals' in dto).toBe(false);
    // One bounded fact read; no session read can change the count without rows.
    expect(factsRead).toHaveBeenCalledTimes(1);
    expect(completedRead).not.toHaveBeenCalled();
    expect(inProgressRead).not.toHaveBeenCalled();
  });
  it("does not count another run's recorded facts when the calendar is empty", async () => {
    const harness = makeHarness([notPerformedFact(ENR_B, OCCURRENCE_W1_1)]);
    await enrolledRun(harness, ENR_A, USER_A);
    await enrolledRun(harness, ENR_B, USER_B);

    // ENR_A has no planned rows and no facts of its own: zero unplaced.
    const mine = await readFollowThrough(harness, USER_A);
    expect(mine).toEqual({
      programSlug: PROGRAM_SLUG,
      today: MON,
      configured: false,
      notPerformedUnplaced: 0,
    });

    // ENR_B's own fact is counted only for ENR_B's owner.
    const theirs = await readFollowThrough(harness, USER_B);
    expect(theirs).toEqual({
      programSlug: PROGRAM_SLUG,
      today: MON,
      configured: false,
      notPerformedUnplaced: 1,
    });
  });

  it('reports no run (and reads no facts) when the user has no enrollment', async () => {
    const harness = makeHarness([notPerformedFact(ENR_A, OCCURRENCE_W1_1)]);
    const factsRead = vi.spyOn(harness.notPerformed, 'listByEnrollment');

    // No run at all: the established `ok(null)` convention holds, and no count
    // is fabricated for a run that does not exist.
    expect(await readFollowThrough(harness)).toBeNull();
    expect(factsRead).not.toHaveBeenCalled();
  });

  it('moves a fact between placed and unplaced exactly as its planned row appears or disappears', async () => {
    const harness = makeHarness([notPerformedFact(ENR_A, OCCURRENCE_W1_1)]);
    await enrolledRun(harness);

    // No row for the recorded occurrence: unplaced, and the run is unconfigured.
    const unplaced = await readFollowThrough(harness);
    expect(unplaced?.configured).toBe(false);
    expect(unplaced?.notPerformedUnplaced).toBe(1);

    // Add a row well OUTSIDE the eight-week horizon (2026-06-01 precedes the
    // horizon start of 2026-08-03). The occurrence is now placed, so it leaves
    // the unplaced count even though no reported week carries its date: the
    // count is a row difference, never a horizon consequence.
    await configure(harness, [planned(ENR_A, OCCURRENCE_W1_1, '2026-06-01')]);
    const placed = await readConfigured(harness);
    expect(placed.weeks).toHaveLength(0);
    expect(placed.totals.planned).toBe(0);
    expect(placed.notPerformedUnplaced).toBe(0);

    // Remove the row again: the fact is unplaced once more.
    await configure(harness, []);
    const removed = await readFollowThrough(harness);
    expect(removed?.configured).toBe(false);
    expect(removed?.notPerformedUnplaced).toBe(1);
  });
});

/**
 * M17 generation fencing: the follow-through read composed into an
 * already-loaded enrollment is tied to THAT enrollment identity, never to a
 * re-resolved current run. Mirrors the closure-fencing contract.
 */
describe('GetEnrollmentFollowThroughUseCase - enrollment identity fencing', () => {
  it('reads the report of EXACTLY the expected enrollment while it exists', async () => {
    // The recorded fact sits on the occurrence that HAS a planned row, so it
    // counts in the reported week (not as a rowless/unplaced fact).
    const harness = makeHarness([notPerformedFact(ENR_A, OCCURRENCE_W1_1)]);
    await enrolledRun(harness);
    await configure(harness, [planned(ENR_A, OCCURRENCE_W1_1, MON)]);

    const result = await harness.useCase.execute({
      userId: USER_A,
      program: PROGRAM,
      now: NOW,
      expectedEnrollmentId: ENR_A,
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) throw new Error('expected a report');
    if (!result.data.configured) throw new Error('expected a configured report');
    expect(result.data.totals.notPerformed).toBe(1);
    expect(result.data.notPerformedUnplaced).toBe(0);
  });

  it('refuses with ENROLLMENT_CHANGED when the expected enrollment was replaced, reading no planned rows', async () => {
    const harness = makeHarness();
    await enrolledRun(harness);
    await harness.enrollments.delete(enrollmentId(ENR_A));
    await harness.enrollments.create(enrollment('enr-a-replacement', USER_A));
    const plannedRead = vi.spyOn(harness.plannedWorkouts, 'listByEnrollment');

    const result = await harness.useCase.execute({
      userId: USER_A,
      program: PROGRAM,
      now: NOW,
      expectedEnrollmentId: ENR_A,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: 'ENROLLMENT_CHANGED' });
    expect(plannedRead).not.toHaveBeenCalled();
  });

  it('refuses when the expected enrollment belongs to another user, reading no planned rows', async () => {
    const harness = makeHarness();
    await enrolledRun(harness, ENR_B, USER_B);
    const plannedRead = vi.spyOn(harness.plannedWorkouts, 'listByEnrollment');

    const result = await harness.useCase.execute({
      userId: USER_A,
      program: PROGRAM,
      now: NOW,
      expectedEnrollmentId: ENR_B,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: 'ENROLLMENT_CHANGED' });
    expect(plannedRead).not.toHaveBeenCalled();
  });

  it('keeps resolving the CURRENT enrollment when no expected id is supplied', async () => {
    const harness = makeHarness();
    await enrolledRun(harness);
    await harness.enrollments.delete(enrollmentId(ENR_A));
    await harness.enrollments.create(enrollment('enr-a-replacement', USER_A));

    // The standalone convention is unchanged: without a fence the read
    // describes whichever run is current - here the replacement (no rows).
    const result = await harness.useCase.execute({ userId: USER_A, program: PROGRAM, now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.data).toMatchObject({ configured: false, notPerformedUnplaced: 0 });
  });
});
