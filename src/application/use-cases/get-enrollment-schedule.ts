/**
 * Use case: the authenticated user's M15 training calendar for one program run.
 *
 * Read-only. Ownership is resolved server-side from the trusted `userId` plus
 * the program pair, so one user can never read another user's schedule, and the
 * caller never supplies an `EnrollmentId`.
 *
 * The program aggregate is supplied by the caller (the `GetProgramEnrollmentUseCase`
 * convention): a request that already loaded the program hydrates it exactly
 * once. Every other fact comes from three bounded, enrollment-scoped reads —
 * the run's planned rows (calendar intent), its completed occurrence ids and
 * its in-progress occurrence ids. No per-item read is issued, no session
 * aggregate, exercise log or set log is hydrated, and nothing is written.
 *
 * Status and focus are derived by the Slice 1 domain rules
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
} from '@/application/dto/schedule';
import type { PlannedWorkoutRepository } from '@/application/ports/planned-workout-repository';
import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import type { WorkoutSessionRepository } from '@/application/ports/workout-session-repository';
import type { PlannedWorkout } from '@/domain/entities/planned-workout';
import type { TrainingProgram } from '@/domain/entities/training-program';
import {
  resolvePlannedWorkoutStatus,
  resolveScheduleFocus,
  type PlannedWorkoutFacts,
} from '@/domain/services/schedule-focus';
import { createUserId, type ScheduledWorkoutId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';
import {
  comparePlannedDates,
  plannedDateFromInstant,
  type PlannedDate,
} from '@/domain/value-objects/planned-date';

export type GetEnrollmentScheduleError = {
  readonly code: 'INVALID_INPUT';
  readonly message: string;
  readonly field?: string;
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
}

export class GetEnrollmentScheduleUseCase {
  constructor(
    private readonly enrollmentRepository: ProgramEnrollmentRepository,
    private readonly plannedWorkoutRepository: PlannedWorkoutRepository,
    private readonly sessionRepository: WorkoutSessionRepository,
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

    const enrollment = await this.enrollmentRepository.findByUserAndProgram(
      userIdResult.data,
      input.program.id,
    );
    if (enrollment === null) {
      return ok(null);
    }

    const today = plannedDateFromInstant(input.now);

    // Three independent, enrollment-scoped projections read in one batch.
    // None of them hydrates sessions, logs or the exercise catalog.
    const [plannedRows, completedIds, inProgressIds] = await Promise.all([
      this.plannedWorkoutRepository.listByEnrollment(enrollment.id),
      this.sessionRepository.listCompletedScheduledWorkoutIds(enrollment.id),
      this.sessionRepository.listInProgressScheduledWorkoutIds(enrollment.id),
    ]);

    if (plannedRows.length === 0) {
      return ok(unconfiguredSchedule(input.program.slug, today));
    }

    return ok(
      buildConfiguredSchedule(input.program, plannedRows, completedIds, inProgressIds, today),
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
  today: PlannedDate,
): EnrollmentScheduleDto {
  const index = buildOccurrenceIndex(program);
  const completed = new Set<ScheduledWorkoutId>(completedIds);
  const inProgress = new Set<ScheduledWorkoutId>(inProgressIds);

  // Calendar order is decided here rather than inherited from the repository,
  // so the view never depends on a storage read's ordering.
  const facts: ReadonlyArray<PlannedWorkoutFacts> = [...plannedRows]
    .sort(comparePlannedWorkouts)
    .map((plannedWorkout) => ({
      plannedWorkout,
      hasCompletedSession: completed.has(plannedWorkout.scheduledWorkoutId),
      hasActiveSession: inProgress.has(plannedWorkout.scheduledWorkoutId),
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
    focus: {
      today: focus.today === null ? null : requireDto(focus.today),
      next: focus.next === null ? null : requireDto(focus.next),
      pastDue:
        focus.pastDue === null
          ? null
          : { count: focus.pastDue.count, earliest: requireDto(focus.pastDue.earliest) },
    },
  };
}

function unconfiguredSchedule(programSlug: string, today: PlannedDate): EnrollmentScheduleDto {
  const focus: ScheduleFocusDto = { today: null, next: null, pastDue: null };
  return { programSlug, configured: false, today, items: [], focus };
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
