/**
 * Use case: set (or change) the authenticated user's training days for the
 * current program run, generating the run's calendar (M15 Slice 4).
 *
 * Training days are the INPUT to schedule generation, never stored: the
 * generated `planned_workouts` rows are the run's calendar, so changing the
 * selection is a regeneration. Generation itself is the Slice 1 domain rule
 * (`generatePlannedSchedule`) — completed occurrences are excluded, in-progress
 * occurrences with an existing row keep their date, and never-started
 * occurrences (including manually rescheduled ones) are re-dated. This use case
 * only supplies facts, persists the complete generated set and maps outcomes.
 *
 * Ownership: the enrollment is resolved server-side from the trusted `userId` +
 * program pair, so one user can never write another user's planning, and the
 * caller never supplies an `EnrollmentId`.
 *
 * ONE write: the whole replacement set goes through Slice 2's atomic
 * `replaceAllForEnrollment`, which locks the enrollment row first. There is no
 * second write and no retry. A `false` result means a concurrent leave or M14
 * restart won, and is mapped from ONE read-only re-check of current truth:
 * no current enrollment (or a replaced one — a different EnrollmentId) →
 * NOT_ENROLLED, because a stale request must never generate into a fresh run;
 * the same enrollment still present → SCHEDULE_CHANGED.
 *
 * Concurrency: the persistence lock serializes writes, but it is taken AFTER
 * this use case generated its candidate schedule from the facts it read.
 * Configure-vs-configure is therefore deliberately settings-style
 * last-writer-wins — no application-level CAS or versioning is invented.
 *
 * Because every input to generation is authored structure plus session-derived
 * fact, this use case can never mark a workout complete, create or resume a
 * session, or change progression, records or training history.
 */

import type { PlannedWorkoutRepository } from '@/application/ports/planned-workout-repository';
import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';
import type { WorkoutSessionRepository } from '@/application/ports/workout-session-repository';
import type { TrainingProgram } from '@/domain/entities/training-program';
import { generatePlannedSchedule } from '@/domain/services/planned-schedule';
import { listScheduledWorkoutsInOrder } from '@/domain/services/program-progress';
import { createUserId, type EnrollmentId, type UserId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';
import { plannedDateFromInstant } from '@/domain/value-objects/planned-date';
import { createTrainingDays } from '@/domain/value-objects/training-days';

export type ConfigureTrainingDaysError =
  | { readonly code: 'INVALID_INPUT'; readonly message: string; readonly field?: string }
  | { readonly code: 'PROGRAM_NOT_FOUND'; readonly slug: string; readonly message: string }
  | { readonly code: 'NOT_ENROLLED'; readonly programSlug: string; readonly message: string }
  | { readonly code: 'INVALID_TRAINING_DAYS'; readonly programSlug: string; readonly message: string }
  | { readonly code: 'SCHEDULE_CHANGED'; readonly programSlug: string; readonly message: string };

export interface ConfigureTrainingDaysInput {
  readonly userId: string;
  readonly programSlug: string;
  /**
   * Raw ISO-8601 weekday numbers (1 = Monday … 7 = Sunday). The domain
   * deduplicates and canonicalizes them; an empty or non-weekday selection is
   * rejected as `INVALID_TRAINING_DAYS`.
   */
  readonly weekdays: ReadonlyArray<number>;
  /** The request clock; "today" is its UTC calendar date (never client input). */
  readonly now: Date;
}

export class ConfigureTrainingDaysUseCase {
  constructor(
    private readonly programRepository: ProgramRepository,
    private readonly enrollmentRepository: ProgramEnrollmentRepository,
    private readonly plannedWorkoutRepository: PlannedWorkoutRepository,
    private readonly sessionRepository: WorkoutSessionRepository,
  ) {}

  async execute(
    input: ConfigureTrainingDaysInput,
  ): Promise<Result<void, ConfigureTrainingDaysError>> {
    const userIdResult = createUserId(input.userId);
    if (!userIdResult.ok) {
      return err({
        code: 'INVALID_INPUT',
        message: userIdResult.error.message,
        field: 'userId',
      });
    }
    const userId = userIdResult.data;

    const program = await this.programRepository.findBySlug(input.programSlug);
    if (program === null) {
      return err({
        code: 'PROGRAM_NOT_FOUND',
        slug: input.programSlug,
        message: `Program "${input.programSlug}" not found`,
      });
    }

    const enrollment = await this.enrollmentRepository.findByUserAndProgram(userId, program.id);
    if (enrollment === null) {
      return err(notEnrolled(program.slug));
    }

    const trainingDaysResult = createTrainingDays(input.weekdays);
    if (!trainingDaysResult.ok) {
      return err({
        code: 'INVALID_TRAINING_DAYS',
        programSlug: program.slug,
        message: trainingDaysResult.error.message,
      });
    }

    const today = plannedDateFromInstant(input.now);

    // Bounded, enrollment-scoped facts: the run's current planning, its
    // completed occurrences and its live occurrences. No session hydration.
    const [currentPlan, completedIds, inProgressIds] = await Promise.all([
      this.plannedWorkoutRepository.listByEnrollment(enrollment.id),
      this.sessionRepository.listCompletedScheduledWorkoutIds(enrollment.id),
      this.sessionRepository.listInProgressScheduledWorkoutIds(enrollment.id),
    ]);

    const generated = generatePlannedSchedule({
      enrollmentId: enrollment.id,
      occurrencesInProgramOrder: listScheduledWorkoutsInOrder(program),
      trainingDays: trainingDaysResult.data,
      today,
      completedIds,
      inProgressIds,
      currentPlan,
    });
    if (!generated.ok) {
      // A contract violation, not a business outcome: a row belonging to
      // another run is corrupt state, and a date leaving the supported
      // calendar range cannot happen for a real training schedule. Failing
      // loudly beats writing a wrong calendar.
      throw new Error(`Schedule generation contract violated: ${generated.error.message}`);
    }

    const replaced = await this.plannedWorkoutRepository.replaceAllForEnrollment(
      enrollment.id,
      generated.data,
    );
    if (replaced) {
      return ok(undefined);
    }

    // The run vanished before the replacement committed. Read-only: exactly one
    // re-check of current truth, never a second write and never a retry.
    return err(await this.mapStaleOutcome(program, userId, enrollment.id));
  }

  /**
   * Truthful mapping of a `false` replacement, from ONE read-only re-check:
   * no current enrollment — or a current enrollment with a DIFFERENT id (a
   * concurrent M14 restart already produced the fresh run) — means a lifecycle
   * write won and the caller's approved run no longer exists → NOT_ENROLLED.
   * A stale request is never applied to the replacement run. The same
   * enrollment still being present cannot happen while the lock is held, so it
   * is reported as SCHEDULE_CHANGED rather than retried.
   */
  private async mapStaleOutcome(
    program: TrainingProgram,
    userId: UserId,
    attemptedEnrollmentId: EnrollmentId,
  ): Promise<ConfigureTrainingDaysError> {
    const current = await this.enrollmentRepository.findByUserAndProgram(userId, program.id);
    if (current === null || current.id !== attemptedEnrollmentId) {
      return notEnrolled(program.slug);
    }
    return scheduleChanged(program.slug);
  }
}

function notEnrolled(programSlug: string): ConfigureTrainingDaysError {
  return {
    code: 'NOT_ENROLLED',
    programSlug,
    message: 'You are not enrolled in this program.',
  };
}

function scheduleChanged(programSlug: string): ConfigureTrainingDaysError {
  return {
    code: 'SCHEDULE_CHANGED',
    programSlug,
    message: 'Your training schedule changed while saving. Please reload and try again.',
  };
}
