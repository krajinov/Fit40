/**
 * M17 Slice 8 — recorded not-performed facts in the M15 calendar, on real
 * PostgreSQL.
 *
 * Proves the production wiring end to end, without duplicating Slice 12's full
 * lifecycle matrix: the real repositories feed the real use cases, so a
 * persisted fact reaches read-time status, the unplaced projection, and
 * regeneration exclusion — and the fact itself is never written, moved or
 * deleted by any of those reads.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { ConfigureTrainingDaysUseCase } from '@/application/use-cases/configure-training-days';
import { GetEnrollmentScheduleUseCase } from '@/application/use-cases/get-enrollment-schedule';
import { GetWorkoutSessionUseCase } from '@/application/use-cases/get-workout-session';

import { countFacts, insertFact } from './not-performed-fixtures';
import {
  allPlannedRows,
  enrollmentIdValue,
  plannedSetFor,
  scheduledWorkoutIdValue,
  seedEnrolledRun,
  type PlannedRunFixture,
} from './planned-workout-fixtures';
import {
  closeDatabase,
  notPerformedOccurrenceRepository,
  plannedWorkoutRepository,
  programEnrollmentRepository,
  programRepository,
  resetAndSeed,
  runOccurrenceWrites,
  workoutSessionRepository,
} from './setup';

const OWNER = 'm17-schedule-owner';
const OTHER_OWNER = 'm17-schedule-other-owner';
const PROGRAM_SLUG = 'strong-at-home';
const RUN = enrollmentIdValue('enr-m17-schedule-a');
const OTHER_RUN = enrollmentIdValue('enr-m17-schedule-b');
/** Wednesday 2026-09-23. */
const NOW = new Date('2026-09-23T09:00:00.000Z');
const RECORDED_AT = '2026-09-23T08:00:00.000Z';

const scheduleUseCase = new GetEnrollmentScheduleUseCase(
  programEnrollmentRepository,
  plannedWorkoutRepository,
  workoutSessionRepository,
  notPerformedOccurrenceRepository,
);

const configureUseCase = new ConfigureTrainingDaysUseCase(
  programRepository,
  programEnrollmentRepository,
  plannedWorkoutRepository,
  workoutSessionRepository,
  notPerformedOccurrenceRepository,
);

const sessionUseCase = new GetWorkoutSessionUseCase(
  programRepository,
  workoutSessionRepository,
  programEnrollmentRepository,
  notPerformedOccurrenceRepository,
);

afterAll(async () => {
  await closeDatabase();
});

/** Reads the calendar through the real use case, asserting success. */
async function readSchedule(fixture: PlannedRunFixture, owner = OWNER) {
  const result = await scheduleUseCase.execute({
    userId: owner,
    program: fixture.program,
    now: NOW,
  });
  if (!result.ok) throw new Error(result.error.message);
  if (result.data === null) throw new Error('expected an enrolled run');
  return result.data;
}

/** The first three authored occurrences, or a loud failure. */
function occurrencesOf(fixture: PlannedRunFixture): readonly [string, string, string] {
  const [first, second, third] = fixture.occurrenceIds;
  if (first === undefined || second === undefined || third === undefined) {
    throw new Error('expected at least three authored occurrences');
  }
  return [first, second, third];
}

describe('M17 Slice 8 — the calendar reports recorded not-performed facts', () => {
  let run: PlannedRunFixture;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
    // A real configured calendar: every authored occurrence dated in order.
    await plannedWorkoutRepository.replaceAllForEnrollment(
      RUN,
      plannedSetFor(run.program, RUN, '2026-09-01'),
    );
  });

  it('reports a recorded occurrence on its row as not-performed', async () => {
    const [first] = occurrencesOf(run);
    await insertFact({ enrollmentId: RUN, scheduledWorkoutId: first, recordedAt: RECORDED_AT });

    const schedule = await readSchedule(run);

    const item = schedule.items.find((candidate) => candidate.scheduledWorkoutId === first);
    expect(item?.status).toBe('not-performed');
    expect(schedule.focus.notPerformedRecorded).toBe(1);
    // It has a row, so it is NOT unplaced.
    expect(schedule.unplacedNotPerformedWorkouts).toEqual([]);

    // The detail read reports the same fact without consulting a session.
    const detail = await sessionUseCase.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      weekNumber: 1,
      workoutOrder: 1,
    });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.data).toEqual({ enrolled: true, session: null, notPerformedRecorded: true });
  });

  it('projects a recorded occurrence whose row is gone instead of erasing it', async () => {
    const [first] = occurrencesOf(run);
    await insertFact({ enrollmentId: RUN, scheduledWorkoutId: first, recordedAt: RECORDED_AT });

    // Regeneration with the fact present removes the recorded occurrence's row
    // (settled occurrences are never re-placed) while the others stay planned.
    const configured = await configureUseCase.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      weekdays: [1, 3, 5],
      now: NOW,
    });
    expect(configured.ok).toBe(true);

    const schedule = await readSchedule(run);

    expect(schedule.items.map((item) => item.scheduledWorkoutId)).not.toContain(first);
    expect(schedule.unplacedNotPerformedWorkouts).toEqual([
      {
        scheduledWorkoutId: first,
        weekNumber: 1,
        workoutOrder: 1,
        workoutName: expect.any(String),
        recordedAtIso: new Date(RECORDED_AT).toISOString(),
      },
    ]);
    // The fact survived the regeneration untouched.
    expect(await countFacts(RUN)).toBe(1);
  });

  it('regenerates without a row for a persisted recorded occurrence', async () => {
    const [, , recordedOccurrence] = occurrencesOf(run);
    await insertFact({
      enrollmentId: RUN,
      scheduledWorkoutId: recordedOccurrence,
      recordedAt: RECORDED_AT,
    });

    const configured = await configureUseCase.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      weekdays: [1, 3, 5],
      now: NOW,
    });
    expect(configured.ok).toBe(true);

    const rows = await allPlannedRows();
    expect(rows.map((row) => row.scheduledWorkoutId)).not.toContain(recordedOccurrence);
    expect(rows).toHaveLength(run.occurrenceIds.length - 1);
    expect(await countFacts(RUN)).toBe(1);
  });
});


describe('M17 Slice 8 — cross-run isolation and the undo lifecycle', () => {
  let run: PlannedRunFixture;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
    await plannedWorkoutRepository.replaceAllForEnrollment(
      RUN,
      plannedSetFor(run.program, RUN, '2026-09-01'),
    );
  });

  it("never leaks another enrollment's recorded fact", async () => {
    await seedEnrolledRun({
      owner: OTHER_OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: OTHER_RUN,
    });
    const [first] = occurrencesOf(run);
    await insertFact({
      enrollmentId: OTHER_RUN,
      scheduledWorkoutId: first,
      recordedAt: RECORDED_AT,
    });

    const configured = await configureUseCase.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      weekdays: [1, 3, 5],
      now: NOW,
    });
    expect(configured.ok).toBe(true);

    const schedule = await readSchedule(run);
    expect(schedule.unplacedNotPerformedWorkouts).toEqual([]);
    expect(schedule.items.map((item) => item.status)).not.toContain('not-performed');
    // The other run's fact is untouched and still belongs to that run.
    expect(await countFacts(OTHER_RUN)).toBe(1);
    expect(await countFacts(RUN)).toBe(0);
  });

  it('plans a previously recorded occurrence again only after an explicit regeneration', async () => {
    const [first] = occurrencesOf(run);
    await insertFact({ enrollmentId: RUN, scheduledWorkoutId: first, recordedAt: RECORDED_AT });

    // Undo removes ONLY the fact (through the real Slice 5 authority).
    const undone = await runOccurrenceWrites.undoNotPerformed({
      enrollmentId: RUN,
      scheduledWorkoutId: scheduledWorkoutIdValue(first),
    });
    expect(undone).toEqual({ kind: 'undo' });
    expect(await countFacts(RUN)).toBe(0);

    // Undo does not regenerate: with the row gone the occurrence is open but
    // unplaced — the read invents no date and no row.
    await plannedWorkoutRepository.replaceAllForEnrollment(
      RUN,
      plannedSetFor(run.program, RUN, '2026-09-01').filter(
        (row) => row.scheduledWorkoutId !== first,
      ),
    );
    const beforeRegeneration = await readSchedule(run);
    expect(beforeRegeneration.items.map((item) => item.scheduledWorkoutId)).not.toContain(first);
    expect(beforeRegeneration.unplacedNotPerformedWorkouts).toEqual([]);

    // The next EXPLICIT regeneration places it again — the only way back.
    const configured = await configureUseCase.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      weekdays: [1, 3, 5],
      now: NOW,
    });
    expect(configured.ok).toBe(true);
    const rows = await allPlannedRows();
    expect(rows.map((row) => row.scheduledWorkoutId)).toContain(first);

    const afterRegeneration = await readSchedule(run);
    expect(afterRegeneration.unplacedNotPerformedWorkouts).toEqual([]);
    expect(afterRegeneration.focus.notPerformedRecorded).toBe(0);
    expect(
      afterRegeneration.items.find((item) => item.scheduledWorkoutId === first)?.status,
    ).not.toBe('not-performed');
  });
});

