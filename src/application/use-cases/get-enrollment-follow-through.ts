/**
 * Use case: the authenticated user's M16 plan follow-through for one program run.
 *
 * Read-only. Ownership is resolved server-side from the trusted `userId` plus
 * the program pair, so one user can never read another user's run and the caller
 * never supplies an `EnrollmentId`.
 *
 * The report reconciles two authorities and never confuses them: calendar intent
 * comes from the run's planned rows (`planned_workouts`) and execution truth
 * from its sessions (`workout_sessions`). Nothing here writes, and no historical
 * plan is reconstructed — the report describes the calendar as it stands now.
 *
 * The program aggregate is supplied by the caller (the
 * `GetEnrollmentScheduleUseCase` / `GetProgramEnrollmentUseCase` convention):
 * the program request that renders the calendar already hydrated it, so this
 * read adds no catalog query. This read never consults the authored program at
 * all — it counts rows, so an occurrence id is an opaque key here.
 *
 * Three authoritative outcomes:
 * - `ok(null)` — the user is not enrolled in this program: there is no run,
 *   hence no report, and no downstream read is issued.
 * - `configured: false` — a run exists but has no planned rows yet: there is
 *   nothing to reconcile, so the session reads are not issued (they could not
 *   change the result) and no zero week is fabricated.
 * - `configured: true` — one fact per CURRENT planned row, summarized by the
 *   Slice 1 Domain rules. This use case never re-decides an outcome or a count.
 *
 * Session-derived facts are a read-time derivation: a session that starts or
 * completes immediately after this read is reflected by the next read. M15
 * deliberately does not serialize planning writes against session writes, so
 * that bounded cosmetic window is accepted — truth stays session-derived.
 */

import {
  toConfiguredFollowThroughDto,
  toUnconfiguredFollowThroughDto,
  type EnrollmentFollowThroughDto,
} from '@/application/dto/follow-through';
import type { PlannedWorkoutRepository } from '@/application/ports/planned-workout-repository';
import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import type {
  CompletedOccurrenceActivity,
  WorkoutSessionRepository,
} from '@/application/ports/workout-session-repository';
import type { PlannedWorkout } from '@/domain/entities/planned-workout';
import type { TrainingProgram } from '@/domain/entities/training-program';
import { summarizeFollowThrough } from '@/domain/services/follow-through-week';
import type { PlannedOccurrenceFacts } from '@/domain/services/plan-follow-through';
import { listRecentTrainingWeekWindows } from '@/domain/services/training-week';
import { createUserId, type ScheduledWorkoutId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';
import { plannedDateFromInstant } from '@/domain/value-objects/planned-date';

/**
 * How many recent UTC training weeks the report covers: the same 8-week horizon
 * the M13 weekly insights use, so the product has one answer to "how far back do
 * we look".
 */
export const FOLLOW_THROUGH_WEEK_COUNT = 8;

export type GetEnrollmentFollowThroughError = {
  readonly code: 'INVALID_INPUT';
  readonly message: string;
  readonly field?: string;
};

export interface GetEnrollmentFollowThroughInput {
  readonly userId: string;
  /**
   * The program aggregate the caller already loaded (e.g. the program detail
   * page's `GetProgramBySlugUseCase` result). The use case never re-queries the
   * catalog, so one request hydrates the program exactly once.
   */
  readonly program: TrainingProgram;
  /** The request clock; `today` and the reported weeks derive from it, in UTC. */
  readonly now: Date;
}

export class GetEnrollmentFollowThroughUseCase {
  constructor(
    private readonly enrollmentRepository: ProgramEnrollmentRepository,
    private readonly plannedWorkoutRepository: PlannedWorkoutRepository,
    private readonly sessionRepository: WorkoutSessionRepository,
  ) {}

  async execute(
    input: GetEnrollmentFollowThroughInput,
  ): Promise<Result<EnrollmentFollowThroughDto | null, GetEnrollmentFollowThroughError>> {
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

    // The run's calendar intent: the only read that can decide whether there is
    // anything to report, so it is deliberately issued before any session read.
    const plannedRows = await this.plannedWorkoutRepository.listByEnrollment(enrollment.id);
    const today = plannedDateFromInstant(input.now);
    if (plannedRows.length === 0) {
      return ok(toUnconfiguredFollowThroughDto(input.program.slug, today));
    }

    // Two independent, enrollment-scoped projections read in one batch: neither
    // decides whether the other should happen (the planned rows above already
    // did), so issuing them together only shortens the read.
    const [completedActivity, inProgressIds] = await Promise.all([
      this.sessionRepository.listCompletedOccurrenceActivity(enrollment.id),
      this.sessionRepository.listInProgressScheduledWorkoutIds(enrollment.id),
    ]);

    return ok(
      toConfiguredFollowThroughDto(
        input.program.slug,
        today,
        summarizeFollowThrough(
          assembleOccurrences(plannedRows, completedActivity, inProgressIds),
          listRecentTrainingWeekWindows(input.now, FOLLOW_THROUGH_WEEK_COUNT),
          input.now,
        ),
      ),
    );
  }
}

/**
 * Builds exactly one fact per CURRENT planned occurrence.
 *
 * Completion and in-progress facts are keyed by occurrence id, so a fact whose
 * occurrence has no planned row simply never joins: it can neither create an
 * extra report occurrence nor be attributed to another run's. Planned rows are
 * iterated once and never deduplicated — `(enrollment, scheduled workout)` is
 * unique in the database, so a duplicate here would be a corrupt read, and the
 * Domain summarizer fails loudly on one rather than merging it.
 */
function assembleOccurrences(
  plannedRows: ReadonlyArray<PlannedWorkout>,
  completedActivity: ReadonlyArray<CompletedOccurrenceActivity>,
  inProgressIds: ReadonlyArray<ScheduledWorkoutId>,
): ReadonlyArray<PlannedOccurrenceFacts> {
  const completedAtByOccurrence = new Map<ScheduledWorkoutId, Date>(
    completedActivity.map((item) => [item.scheduledWorkoutId, item.completedAt]),
  );
  const inProgress = new Set<ScheduledWorkoutId>(inProgressIds);

  return plannedRows.map((plannedWorkout) => ({
    scheduledWorkoutId: plannedWorkout.scheduledWorkoutId,
    plannedDate: plannedWorkout.plannedDate,
    completedAt: completedAtByOccurrence.get(plannedWorkout.scheduledWorkoutId) ?? null,
    hasActiveSession: inProgress.has(plannedWorkout.scheduledWorkoutId),
  }));
}
