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
import type { FollowThroughSummary } from '@/domain/services/follow-through-week';
import { InMemoryProgramEnrollmentRepository } from '@/infrastructure/enrollments/in-memory-program-enrollment-repository';
import { InMemoryPlannedWorkoutRepository } from '@/infrastructure/scheduling/in-memory-planned-workout-repository';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';

import {
  enrollment,
  enrollmentId,
  LAST_FRI,
  LAST_WED,
  makeProgram,
  MON,
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

function makeHarness() {
  const enrollments = new InMemoryProgramEnrollmentRepository();
  const plannedWorkouts = new InMemoryPlannedWorkoutRepository();
  const sessions = new InMemoryWorkoutSessionRepository();
  const useCase = new GetEnrollmentFollowThroughUseCase(enrollments, plannedWorkouts, sessions);
  return { enrollments, plannedWorkouts, sessions, useCase };
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
    // unconfigured variant carries neither.
    expect(dto).toEqual({ programSlug: PROGRAM_SLUG, today: MON, configured: false });
    expect(dto !== null && 'weeks' in dto).toBe(false);
    expect(dto !== null && 'totals' in dto).toBe(false);
    // The planned rows had to be read to learn that; the session reads could not
    // have changed the answer, so they are not issued.
    expect(plannedRead).toHaveBeenCalledTimes(1);
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
    expect(Object.keys(dto)).toEqual(['programSlug', 'today', 'configured', 'weeks', 'totals']);
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
    });
    expect(dto.totals).toEqual({
      planned: 6,
      completed: 3,
      completedEarly: 1,
      completedLate: 1,
      started: 1,
      pastDue: 1,
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

  it('issues the two activity reads concurrently', async () => {
    const harness = makeHarness();
    await enrolledRun(harness);
    await configure(harness, [planned(ENR_A, OCCURRENCE_W1_1, MON)]);

    let openGate: () => void = () => {};
    const gateOpened = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    let inFlight = 0;
    let maxInFlight = 0;
    /**
     * Holds a read open until the other one arrives, with a bounded fallback: a
     * sequential implementation then fails the overlap assertion instead of
     * hanging the suite.
     */
    const tracked = async <T>(read: () => Promise<T>): Promise<T> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (inFlight === 2) openGate();
      try {
        await Promise.race([
          gateOpened,
          new Promise<void>((resolve) => setTimeout(resolve, 25)),
        ]);
        return await read();
      } finally {
        inFlight -= 1;
      }
    };

    const completed = harness.sessions.listCompletedOccurrenceActivity.bind(harness.sessions);
    const inProgress = harness.sessions.listInProgressScheduledWorkoutIds.bind(harness.sessions);
    vi.spyOn(harness.sessions, 'listCompletedOccurrenceActivity').mockImplementation(() =>
      tracked(() => completed(enrollmentId(ENR_A))),
    );
    vi.spyOn(harness.sessions, 'listInProgressScheduledWorkoutIds').mockImplementation(() =>
      tracked(() => inProgress(enrollmentId(ENR_A))),
    );

    await readConfigured(harness);

    // Both reads were in flight together: neither decides whether the other runs.
    expect(maxInFlight).toBe(2);
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
        },
      ],
      totals: {
        planned: 9,
        completed: 9,
        completedEarly: 9,
        completedLate: 9,
        started: 9,
        pastDue: 9,
      },
    };

    const dto = toConfiguredFollowThroughDto(PROGRAM_SLUG, plannedDate(MON), summary);

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
    });
    expect(dto.totals).toEqual(summary.totals);
  });
});
