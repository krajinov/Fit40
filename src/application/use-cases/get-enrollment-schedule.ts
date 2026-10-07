/**
 * Use case: the authenticated user's M15 training calendar for one program run.
 *
 * Read-only. Ownership is resolved server-side from the trusted `userId` plus
 * the program pair, so one user can never read another user's schedule, and the
 * caller never supplies an `EnrollmentId`.
 *
 * The program aggregate is supplied by the caller (the `GetProgramEnrollmentUseCase`
 * convention): a request that already loaded the program hydrates it exactly
 * once. Every other fact comes from two bounded, enrollment-scoped reads —
 * the run's planned rows (calendar intent) and its execution truth (completed
 * occurrence ids, in-progress occurrence ids and recorded-not-performed facts)
 * projected from ONE coherent database snapshot. Session execution truth and
 * settlement facts are mutually exclusive per occurrence, so they are never
 * assembled from independent statements that could tear across a concurrent
 * `recordNotPerformed` transition. No per-item read is issued, no session
 * aggregate, exercise log or set log is hydrated, and nothing is written.
 *
 * The three facts are kept strictly separate: a planned row is calendar intent,
 * a not-performed fact is execution truth, and the authored occurrence is
 * program intent. A recorded occurrence therefore shows the fact's status where
 * it has a row, and — when it has no row at all — appears in
 * `unplacedNotPerformedWorkouts` instead of being erased or given a fabricated
 * date. Status and focus are derived by the Slice 1 domain rules
 * (`resolvePlannedWorkoutStatus` / `resolveScheduleFocus`); this use case never
 * re-decides them. Training history, progression, records and completion are
 * untouched by construction: they all read completed WorkoutSessions, which
 * this use case never writes.
 *
 * A run with no planned rows is a normal state, not an error: `configured` is
 * false, `items` is empty and no date is invented.
 *
 * A persisted planned row that is not an occurrence of the supplied program is
 * a corrupt-state contract violation (planning is enrollment-scoped and the
 * program is its authored authority), so it fails loudly instead of being
 * silently omitted from the calendar.
 *
 * Session-derived status is a read-time derivation: a session that starts or
 * completes immediately after this read is reflected by the next read. Slice 2
 * deliberately does not serialize planning writes against session writes, so
 * that bounded cosmetic window is accepted — truth stays session-derived.
 */

import type {
  EnrollmentScheduleDto,
  PlannedWorkoutDto,
  ScheduleFocusDto,
  UnplacedNotPerformedWorkoutDto,
} from '@/application/dto/schedule';
import type { PlannedWorkoutRepository } from '@/application/ports/planned-workout-repository';
import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import type {
  ScheduleExecutionFacts,
  ScheduleExecutionFactsRepository,
} from '@/application/ports/schedule-execution-facts-repository';
import type { NotPerformedOccurrence } from '@/domain/entities/not-performed-occurrence';
import type { PlannedWorkout } from '@/domain/entities/planned-workout';
import type { TrainingProgram } from '@/domain/entities/training-program';
import {
  resolvePlannedWorkoutStatus,
  resolveScheduleFocus,
  type PlannedWorkoutFacts,
} from '@/domain/services/schedule-focus';
import {
  createEnrollmentId,
  createUserId,
  type ScheduledWorkoutId,
  type UserId,
} from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';
import {
  comparePlannedDates,
  plannedDateFromInstant,
  type PlannedDate,
} from '@/domain/value-objects/planned-date';

export type GetEnrollmentScheduleError =
  | {
      readonly code: 'INVALID_INPUT';
      readonly message: string;
      readonly field?: string;
    }
  | {
      /**
       * The caller's expected enrollment no longer exists (a concurrent
       * restart/leave replaced the run): the read refuses to compose the caller's
       * old-enrollment parent with a new run's calendar. Never thrown — the
       * caller degrades, never mixing generations.
       */
      readonly code: 'ENROLLMENT_CHANGED';
      readonly message: string;
    };

export interface GetEnrollmentScheduleInput {
  readonly userId: string;
  /**
   * The program aggregate the caller already loaded (e.g. the program detail
   * page's `GetProgramBySlugUseCase` result or the dashboard's current
   * program). The use case never re-queries the catalog, so one request
   * hydrates the program exactly once.
   */
  readonly program: TrainingProgram;
  /** The request clock; the calendar date is derived from it in UTC. */
  readonly now: Date;
  /**
   * The SPECIFIC enrollment the caller already loaded and is composing this
   * calendar into (the dashboard's / program detail's enrollment view). When
   * supplied, the read is fenced to exactly that identity: it never re-resolves
   * the current enrollment, so a concurrent restart/leave cannot compose the
   * caller's old-enrollment parent data with a NEW run's calendar. Omitted (or
   * undefined), the read resolves the current enrollment as before — the
   * standalone read convention.
   */
  readonly expectedEnrollmentId?: string;
}

export class GetEnrollmentScheduleUseCase {
  constructor(
    private readonly enrollmentRepository: ProgramEnrollmentRepository,
    private readonly plannedWorkoutRepository: PlannedWorkoutRepository,
    private readonly scheduleExecutionFactsRepository: ScheduleExecutionFactsRepository,
  ) {}

  async execute(
    input: GetEnrollmentScheduleInput,
  ): Promise<Result<EnrollmentScheduleDto | null, GetEnrollmentScheduleError>> {
    const userIdResult = createUserId(input.userId);
    if (!userIdResult.ok) {
      return err({
        code: 'INVALID_INPUT',
        message: userIdResult.error.message,
        field: 'userId',
      });
    }

    // The fenced path: identity and facts in ONE statement — never a validate
    // call followed by an independent facts call, whose window a concurrent
    // restart/leave could open.
    if (input.expectedEnrollmentId !== undefined) {
      return this.executeFenced(input.expectedEnrollmentId, userIdResult.data, input);
    }

    const enrollment = await this.enrollmentRepository.findByUserAndProgram(
      userIdResult.data,
      input.program.id,
    );
    if (enrollment === null) {
      return ok(null);
    }

    const today = plannedDateFromInstant(input.now);

    // Two enrollment-scoped reads in one batch: the planned rows (calendar
    // intent — the documented intent-vs-execution cosmetic window is
    // unchanged) and the execution truth from ONE coherent snapshot, so a
    // concurrent settlement transition can never pair a stale in-progress
    // session with the fresh record. No session aggregate, log or catalog
    // hydration, and never one query per planned row or per occurrence.
    const [plannedRows, executionFacts] = await Promise.all([
      this.plannedWorkoutRepository.listByEnrollment(enrollment.id),
      this.scheduleExecutionFactsRepository.listScheduleExecutionFactsByEnrollment(enrollment.id),
    ]);

    return ok(this.buildSchedule(input.program, plannedRows, executionFacts, today));
  }

  /**
   * The standalone projection, shared by both paths so the fenced read derives
   * the SAME calendar semantics — nothing is re-decided per path.
   */
  private buildSchedule(
    program: TrainingProgram,
    plannedRows: ReadonlyArray<PlannedWorkout>,
    executionFacts: ScheduleExecutionFacts,
    today: PlannedDate,
  ): EnrollmentScheduleDto {
    const { completedIds, inProgressIds, notPerformedFacts } = executionFacts;

    if (plannedRows.length === 0) {
      // No current calendar — but a recorded fact is execution truth and is
      // never erased by the absence of a row, so it is still projected.
      return unconfiguredSchedule(program, today, notPerformedFacts);
    }

    return buildConfiguredSchedule(
      program,
      plannedRows,
      completedIds,
      inProgressIds,
      notPerformedFacts,
      today,
    );
  }

  /**
   * The fenced read: ONE statement establishes BOTH that the caller's expected
   * enrollment is still this user's run of this program AND that run's
   * execution facts (the closure-fence pattern); the planned rows are read by
   * that exact identity, so no read of this path can ever describe another
   * generation.
   *
   * `matched: false` (gone, replaced, or not the trusted pair's — a foreign id
   * never leaks another user's run) is the typed `ENROLLMENT_CHANGED`
   * refusal, never absence and never a calendar: the caller is composing a
   * view for a run that DID exist, so empty facts must never be rendered as
   * an unconfigured run. A malformed id is the same refusal.
   */
  private async executeFenced(
    expectedEnrollmentId: string,
    userId: UserId,
    input: GetEnrollmentScheduleInput,
  ): Promise<Result<EnrollmentScheduleDto | null, GetEnrollmentScheduleError>> {
    const expectedId = createEnrollmentId(expectedEnrollmentId);
    if (!expectedId.ok) {
      return err({
        code: 'ENROLLMENT_CHANGED',
        message: 'The expected enrollment id is invalid, so the schedule cannot be read',
      });
    }

    const projection = await this.scheduleExecutionFactsRepository.findFencedScheduleExecutionFactsByEnrollment(
      expectedId.data,
      userId,
      input.program.id,
    );
    if (!projection.matched) {
      return err({
        code: 'ENROLLMENT_CHANGED',
        message: 'Your enrollment changed while reading the schedule. Please reload and try again.',
      });
    }

    // The planned rows come from the SAME fenced statement (the one-snapshot
    // contract): never a second read, whose window a restart/leave could open
    // and hand this read a vanished run's empty rows as a false
    // `configured: false`.
    return ok(
      this.buildSchedule(input.program, projection.plannedRows, projection.facts, plannedDateFromInstant(input.now)),
    );
  }
}

/** Authored occurrence metadata, keyed by occurrence id. */
interface OccurrenceMetadata {
  readonly weekNumber: number;
  readonly workoutOrder: number;
  readonly workoutName: string;
}

function buildConfiguredSchedule(
  program: TrainingProgram,
  plannedRows: ReadonlyArray<PlannedWorkout>,
  completedIds: ReadonlyArray<ScheduledWorkoutId>,
  inProgressIds: ReadonlyArray<ScheduledWorkoutId>,
  notPerformedFacts: ReadonlyArray<NotPerformedOccurrence>,
  today: PlannedDate,
): EnrollmentScheduleDto {
  const index = buildOccurrenceIndex(program);
  const completed = new Set<ScheduledWorkoutId>(completedIds);
  const inProgress = new Set<ScheduledWorkoutId>(inProgressIds);
  const recorded = new Set<ScheduledWorkoutId>(
    notPerformedFacts.map((fact) => fact.scheduledWorkoutId),
  );

  // Calendar order is decided here rather than inherited from the repository,
  // so the view never depends on a storage read's ordering.
  const facts: ReadonlyArray<PlannedWorkoutFacts> = [...plannedRows]
    .sort(comparePlannedWorkouts)
    .map((plannedWorkout) => ({
      plannedWorkout,
      hasCompletedSession: completed.has(plannedWorkout.scheduledWorkoutId),
      hasActiveSession: inProgress.has(plannedWorkout.scheduledWorkoutId),
      hasNotPerformedRecord: recorded.has(plannedWorkout.scheduledWorkoutId),
    }));

  const dtoById = new Map<string, PlannedWorkoutDto>();
  for (const fact of facts) {
    dtoById.set(
      fact.plannedWorkout.scheduledWorkoutId,
      toPlannedWorkoutDto(fact, index, today, program.slug),
    );
  }

  const requireDto = (fact: PlannedWorkoutFacts): PlannedWorkoutDto => {
    const dto = dtoById.get(fact.plannedWorkout.scheduledWorkoutId);
    if (dto === undefined) {
      throw new Error(
        'Schedule contract violated: focus resolved to a planned workout outside the run',
      );
    }
    return dto;
  };

  const focus = resolveScheduleFocus(facts, today);

  return {
    programSlug: program.slug,
    configured: true,
    today,
    items: facts.map(requireDto),
    unplacedNotPerformedWorkouts: projectUnplacedNotPerformed(
      notPerformedFacts,
      new Set(facts.map((fact) => fact.plannedWorkout.scheduledWorkoutId)),
      index,
      program.slug,
    ),
    focus: {
      today: focus.today === null ? null : requireDto(focus.today),
      next: focus.next === null ? null : requireDto(focus.next),
      pastDue:
        focus.pastDue === null
          ? null
          : { count: focus.pastDue.count, earliest: requireDto(focus.pastDue.earliest) },
      notPerformedRecorded: focus.notPerformedRecorded,
    },
  };
}

function unconfiguredSchedule(
  program: TrainingProgram,
  today: PlannedDate,
  notPerformedFacts: ReadonlyArray<NotPerformedOccurrence>,
): EnrollmentScheduleDto {
  // No current calendar: `items` stays empty and no date is invented. The
  // recorded facts are still projected, because "this occurrence was recorded as
  // not performed" is execution truth that exists independently of a row.
  const focus: ScheduleFocusDto = {
    today: null,
    next: null,
    pastDue: null,
    notPerformedRecorded: 0,
  };
  return {
    programSlug: program.slug,
    configured: false,
    today,
    items: [],
    unplacedNotPerformedWorkouts: projectUnplacedNotPerformed(
      notPerformedFacts,
      new Set(),
      buildOccurrenceIndex(program),
      program.slug,
    ),
    focus,
  };
}

/**
 * The unplaced projection: recorded facts whose occurrence holds NO current
 * planned row.
 *
 * This is a set difference in memory between two enrollment-scoped reads — no
 * second query, no synthetic `PlannedWorkout` row, and no date. It is
 * deliberately horizon-independent: a recorded occurrence whose authored history
 * would sit far in the past, today, or far in the future is projected exactly
 * the same way, because the only condition is the ABSENCE of a current row.
 *
 * Ordering is authored program order (week, then order), never the storage
 * read's ordering, so the list is deterministic for a given run.
 */
function projectUnplacedNotPerformed(
  notPerformedFacts: ReadonlyArray<NotPerformedOccurrence>,
  occurrenceIdsWithRows: ReadonlySet<ScheduledWorkoutId>,
  index: ReadonlyMap<ScheduledWorkoutId, OccurrenceMetadata>,
  programSlug: string,
): ReadonlyArray<UnplacedNotPerformedWorkoutDto> {
  return notPerformedFacts
    .filter((fact) => !occurrenceIdsWithRows.has(fact.scheduledWorkoutId))
    .map((fact) => ({ fact, metadata: requireOccurrence(index, fact.scheduledWorkoutId, programSlug) }))
    .sort(
      (a, b) =>
        a.metadata.weekNumber - b.metadata.weekNumber ||
        a.metadata.workoutOrder - b.metadata.workoutOrder ||
        (a.fact.scheduledWorkoutId < b.fact.scheduledWorkoutId
          ? -1
          : a.fact.scheduledWorkoutId > b.fact.scheduledWorkoutId
            ? 1
            : 0),
    )
    .map(({ fact, metadata }) => ({
      scheduledWorkoutId: fact.scheduledWorkoutId,
      weekNumber: metadata.weekNumber,
      workoutOrder: metadata.workoutOrder,
      workoutName: metadata.workoutName,
      recordedAtIso: fact.recordedAt.toISOString(),
    }));
}

/**
 * The authored occurrence behind an id, or a loud failure.
 *
 * A recorded fact is enrollment-scoped and its occurrence is a database FK into
 * the authored program, so an id outside the supplied program means the fact and
 * the program aggregate disagree — corrupt state. Omitting it would silently drop
 * recorded truth from the calendar, and fabricating an authored occurrence would
 * invent program content, so this read refuses both.
 */
function requireOccurrence(
  index: ReadonlyMap<ScheduledWorkoutId, OccurrenceMetadata>,
  scheduledWorkoutId: ScheduledWorkoutId,
  programSlug: string,
): OccurrenceMetadata {
  const metadata = index.get(scheduledWorkoutId);
  if (metadata === undefined) {
    throw new Error(
      `Schedule contract violated: recorded occurrence "${scheduledWorkoutId}" is not an occurrence of program "${programSlug}"`,
    );
  }
  return metadata;
}

function toPlannedWorkoutDto(
  fact: PlannedWorkoutFacts,
  index: ReadonlyMap<ScheduledWorkoutId, OccurrenceMetadata>,
  today: PlannedDate,
  programSlug: string,
): PlannedWorkoutDto {
  const { plannedWorkout } = fact;
  const metadata = index.get(plannedWorkout.scheduledWorkoutId);
  if (metadata === undefined) {
    // Planning is enrollment-scoped and the program is the authored authority
    // for occurrences, so a row outside the program is corrupt state: omitting
    // it would silently hide a planned workout from the calendar.
    throw new Error(
      `Schedule contract violated: planned workout "${plannedWorkout.scheduledWorkoutId}" of enrollment "${plannedWorkout.enrollmentId}" is not an occurrence of program "${programSlug}"`,
    );
  }

  return {
    scheduledWorkoutId: plannedWorkout.scheduledWorkoutId,
    weekNumber: metadata.weekNumber,
    workoutOrder: metadata.workoutOrder,
    workoutName: metadata.workoutName,
    plannedDate: plannedWorkout.plannedDate,
    status: resolvePlannedWorkoutStatus(fact, today),
  };
}

/**
 * Indexes every authored occurrence by id.
 *
 * The program factory already guarantees that each occurrence references an
 * existing workout template, so a missing name is a corrupt aggregate rather
 * than a business outcome — it fails loudly (the `requireItem` convention).
 */
function buildOccurrenceIndex(
  program: TrainingProgram,
): ReadonlyMap<ScheduledWorkoutId, OccurrenceMetadata> {
  const nameByWorkoutId = new Map<string, string>(
    program.workouts.map((workout) => [workout.id, workout.name]),
  );

  const index = new Map<ScheduledWorkoutId, OccurrenceMetadata>();
  for (const week of program.weeks) {
    for (const scheduled of week.scheduledWorkouts) {
      const workoutName = nameByWorkoutId.get(scheduled.workoutId);
      if (workoutName === undefined) {
        throw new Error(
          `Schedule contract violated: program "${program.slug}" occurrence "${scheduled.id}" references unknown workout "${scheduled.workoutId}"`,
        );
      }
      index.set(scheduled.id, {
        weekNumber: week.weekNumber,
        workoutOrder: scheduled.order,
        workoutName,
      });
    }
  }
  return index;
}

/** Calendar order: planned date ascending, then occurrence id (total order). */
function comparePlannedWorkouts(a: PlannedWorkout, b: PlannedWorkout): number {
  const byDate = comparePlannedDates(a.plannedDate, b.plannedDate);
  if (byDate !== 0) {
    return byDate;
  }
  if (a.scheduledWorkoutId === b.scheduledWorkoutId) {
    return 0;
  }
  return a.scheduledWorkoutId < b.scheduledWorkoutId ? -1 : 1;
}
