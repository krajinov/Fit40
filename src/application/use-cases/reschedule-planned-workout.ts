/**
 * Use case: move one planned workout of the current run to another calendar
 * date (M15 Slice 4).
 *
 * The public address of a planned workout is its authored route coordinates
 * (`programSlug` + `weekNumber` + `workoutOrder`), resolved to the authored
 * occurrence server-side. A caller never supplies an `EnrollmentId` or a
 * `ScheduledWorkoutId`, so a browser cannot address another user's run or
 * planning.
 *
 * ONE write at most: Slice 2's `reschedule` locks the enrollment row first and
 * performs one UPDATE. There is no second write, no retry loop and no
 * application-level CAS: a `false` result means a lifecycle write (leave or M14
 * restart) removed the run or the row, and is mapped from ONE read-only
 * re-check of current truth — no current enrollment, or a current enrollment
 * with a DIFFERENT id (the restart replacement), resolves to NOT_ENROLLED so a
 * stale request can never retarget a fresh run; the same enrollment still
 * present resolves to SCHEDULE_CHANGED.
 *
 * Eligibility is decided from the run's own facts: a completed occurrence can
 * never be moved and an occurrence with a live session is frozen where it is.
 * The date is validated by the Slice 1 value object and may never be in the
 * past. Moving a planned workout to the date it already holds is a successful
 * no-op: no write is issued.
 *
 * Calendar intent only — this use case never creates, resumes or completes a
 * session, never marks a workout complete, and never touches training history,
 * progression, records or M14 completion. A workout whose planned date has
 * passed stays incomplete and required: M15 has no automatic rescheduling.
 *
 * Accepted bounded race: session start/complete is deliberately not serialized
 * against planning writes (Slice 2's lock is compatible with the session FK's
 * key-share lock), so a session may begin immediately after the eligibility
 * read. The consequence is cosmetic — the next read reports the
 * session-derived status, and no truth is mutated.
 */

import {
  PlannedDateConflictError,
  type PlannedWorkoutRepository,
} from '@/application/ports/planned-workout-repository';
import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';
import type { WorkoutSessionRepository } from '@/application/ports/workout-session-repository';
import type { TrainingProgram } from '@/domain/entities/training-program';
import { findScheduledWorkoutOccurrence } from '@/domain/services/scheduled-workout';
import { createUserId, type EnrollmentId, type UserId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';
import {
  createPlannedDate,
  isPlannedDateBefore,
  plannedDateFromInstant,
  plannedDatesEqual,
} from '@/domain/value-objects/planned-date';

export type ReschedulePlannedWorkoutError =
  | { readonly code: 'INVALID_INPUT'; readonly message: string; readonly field?: string }
  | { readonly code: 'PROGRAM_NOT_FOUND'; readonly slug: string; readonly message: string }
  | {
      readonly code: 'SCHEDULED_WORKOUT_NOT_FOUND';
      readonly programSlug: string;
      readonly weekNumber: number;
      readonly workoutOrder: number;
      readonly message: string;
    }
  | { readonly code: 'NOT_ENROLLED'; readonly programSlug: string; readonly message: string }
  | { readonly code: 'SCHEDULE_NOT_CONFIGURED'; readonly programSlug: string; readonly message: string }
  | {
      readonly code: 'PLANNED_WORKOUT_NOT_FOUND';
      readonly programSlug: string;
      readonly scheduledWorkoutId: string;
      readonly message: string;
    }
  | { readonly code: 'INVALID_DATE'; readonly value: string; readonly message: string }
  | {
      readonly code: 'DATE_IN_PAST';
      readonly programSlug: string;
      readonly date: string;
      readonly today: string;
      readonly message: string;
    }
  | {
      readonly code: 'WORKOUT_ALREADY_COMPLETED';
      readonly programSlug: string;
      readonly scheduledWorkoutId: string;
      readonly message: string;
    }
  | {
      readonly code: 'SESSION_IN_PROGRESS';
      readonly programSlug: string;
      readonly scheduledWorkoutId: string;
      readonly message: string;
    }
  | {
      readonly code: 'DATE_ALREADY_PLANNED';
      readonly programSlug: string;
      readonly date: string;
      readonly message: string;
    }
  | { readonly code: 'SCHEDULE_CHANGED'; readonly programSlug: string; readonly message: string };

export interface ReschedulePlannedWorkoutInput {
  readonly userId: string;
  readonly programSlug: string;
  /** Authored route coordinates of the planned workout to move. */
  readonly weekNumber: number;
  readonly workoutOrder: number;
  /** The requested target date in canonical `YYYY-MM-DD` form. */
  readonly date: string;
  /** The request clock; "today" is its UTC calendar date (never client input). */
  readonly now: Date;
}

export class ReschedulePlannedWorkoutUseCase {
  constructor(
    private readonly programRepository: ProgramRepository,
    private readonly enrollmentRepository: ProgramEnrollmentRepository,
    private readonly plannedWorkoutRepository: PlannedWorkoutRepository,
    private readonly sessionRepository: WorkoutSessionRepository,
  ) {}

  async execute(
    input: ReschedulePlannedWorkoutInput,
  ): Promise<Result<void, ReschedulePlannedWorkoutError>> {
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

    // Public coordinates → the authored occurrence. A malformed coordinate
    // simply finds nothing (the `StartWorkoutSessionUseCase` convention).
    const occurrence = findScheduledWorkoutOccurrence(
      program,
      input.weekNumber,
      input.workoutOrder,
    );
    if (occurrence === null) {
      return err({
        code: 'SCHEDULED_WORKOUT_NOT_FOUND',
        programSlug: program.slug,
        weekNumber: input.weekNumber,
        workoutOrder: input.workoutOrder,
        message: `Scheduled workout not found for week ${input.weekNumber}, order ${input.workoutOrder}`,
      });
    }
    const scheduledWorkoutId = occurrence.scheduled.id;

    const enrollment = await this.enrollmentRepository.findByUserAndProgram(userId, program.id);
    if (enrollment === null) {
      return err(notEnrolled(program.slug));
    }

    const targetResult = createPlannedDate(input.date);
    if (!targetResult.ok) {
      return err({ code: 'INVALID_DATE', value: input.date, message: targetResult.error.message });
    }
    const targetDate = targetResult.data;

    const today = plannedDateFromInstant(input.now);
    if (isPlannedDateBefore(targetDate, today)) {
      return err({
        code: 'DATE_IN_PAST',
        programSlug: program.slug,
        date: targetDate,
        today,
        message: 'A planned workout cannot be moved into the past.',
      });
    }

    const [currentPlan, completedIds, inProgressIds] = await Promise.all([
      this.plannedWorkoutRepository.listByEnrollment(enrollment.id),
      this.sessionRepository.listCompletedScheduledWorkoutIds(enrollment.id),
      this.sessionRepository.listInProgressScheduledWorkoutIds(enrollment.id),
    ]);

    if (currentPlan.length === 0) {
      return err(scheduleNotConfigured(program.slug));
    }

    const currentPlanned = currentPlan.find(
      (planned) => planned.scheduledWorkoutId === scheduledWorkoutId,
    );
    if (currentPlanned === undefined) {
      // Configured run, but nothing is planned for this occurrence: it was
      // never planned here, or a regeneration removed the row because the
      // occurrence completed. Either way there is no intent to move.
      return err(plannedWorkoutNotFound(program.slug, scheduledWorkoutId));
    }

    if (completedIds.includes(scheduledWorkoutId)) {
      return err(workoutAlreadyCompleted(program.slug, scheduledWorkoutId));
    }
    if (inProgressIds.includes(scheduledWorkoutId)) {
      return err(sessionInProgress(program.slug, scheduledWorkoutId));
    }

    if (plannedDatesEqual(currentPlanned.plannedDate, targetDate)) {
      // Already where the caller wants it: success without any write.
      return ok(undefined);
    }

    let moved: boolean;
    try {
      moved = await this.plannedWorkoutRepository.reschedule(
        enrollment.id,
        scheduledWorkoutId,
        targetDate,
      );
    } catch (error) {
      if (error instanceof PlannedDateConflictError) {
        return err({
          code: 'DATE_ALREADY_PLANNED',
          programSlug: program.slug,
          date: targetDate,
          message: `Another planned workout is already scheduled for ${targetDate}.`,
        });
      }
      throw error;
    }

    if (moved) {
      return ok(undefined);
    }

    // The run (or the row) vanished before the update committed. Read-only:
    // exactly one re-check of current truth, never a second write.
    return err(await this.mapStaleOutcome(program, userId, enrollment.id));
  }

  /**
   * Truthful mapping of a `false` update, from ONE read-only re-check: no
   * current enrollment, or a current enrollment with a DIFFERENT id (the M14
   * restart replacement), means the approved run no longer exists →
   * NOT_ENROLLED. The same enrollment still being present means only the
   * planned row moved away (a regeneration excluded or completed the
   * occurrence) → SCHEDULE_CHANGED. A stale request is never applied to the
   * fresh run.
   */
  private async mapStaleOutcome(
    program: TrainingProgram,
    userId: UserId,
    attemptedEnrollmentId: EnrollmentId,
  ): Promise<ReschedulePlannedWorkoutError> {
    const current = await this.enrollmentRepository.findByUserAndProgram(userId, program.id);
    if (current === null || current.id !== attemptedEnrollmentId) {
      return notEnrolled(program.slug);
    }
    return scheduleChanged(program.slug);
  }
}

function notEnrolled(programSlug: string): ReschedulePlannedWorkoutError {
  return { code: 'NOT_ENROLLED', programSlug, message: 'You are not enrolled in this program.' };
}

function scheduleNotConfigured(programSlug: string): ReschedulePlannedWorkoutError {
  return {
    code: 'SCHEDULE_NOT_CONFIGURED',
    programSlug,
    message: 'This program run has no training schedule yet.',
  };
}

function plannedWorkoutNotFound(
  programSlug: string,
  scheduledWorkoutId: string,
): ReschedulePlannedWorkoutError {
  return {
    code: 'PLANNED_WORKOUT_NOT_FOUND',
    programSlug,
    scheduledWorkoutId,
    message: 'This workout is not part of your current schedule.',
  };
}

function workoutAlreadyCompleted(
  programSlug: string,
  scheduledWorkoutId: string,
): ReschedulePlannedWorkoutError {
  return {
    code: 'WORKOUT_ALREADY_COMPLETED',
    programSlug,
    scheduledWorkoutId,
    message: 'This workout is already completed and cannot be rescheduled.',
  };
}

function sessionInProgress(
  programSlug: string,
  scheduledWorkoutId: string,
): ReschedulePlannedWorkoutError {
  return {
    code: 'SESSION_IN_PROGRESS',
    programSlug,
    scheduledWorkoutId,
    message: 'This workout has a session in progress and cannot be rescheduled.',
  };
}

function scheduleChanged(programSlug: string): ReschedulePlannedWorkoutError {
  return {
    code: 'SCHEDULE_CHANGED',
    programSlug,
    message: 'Your training schedule changed while saving. Please reload and try again.',
  };
}
