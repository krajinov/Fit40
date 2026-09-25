/**
 * Composition root for the M15 scheduling feature.
 *
 * This is the single place where the concrete Drizzle repositories are wired
 * into the scheduling use cases. To replace an adapter, change only this file.
 *
 * Every use case here receives the request clock (`now`) from its caller and
 * resolves ownership from the trusted `userId` plus the program pair — the
 * presentation layer supplies the session user, never a client-supplied id.
 */

import { ConfigureTrainingDaysUseCase } from '@/application/use-cases/configure-training-days';
import { GetEnrollmentScheduleUseCase } from '@/application/use-cases/get-enrollment-schedule';
import { ReschedulePlannedWorkoutUseCase } from '@/application/use-cases/reschedule-planned-workout';
import {
  plannedWorkoutRepository,
  programEnrollmentRepository,
  programRepository,
  workoutSessionRepository,
} from '@/infrastructure/database/repositories';

/**
 * The run's training calendar (planned dates, statuses and focus). Read-only:
 * the caller passes the program aggregate it already loaded, so one request
 * hydrates the program exactly once.
 */
export const getEnrollmentScheduleUseCase = new GetEnrollmentScheduleUseCase(
  programEnrollmentRepository,
  plannedWorkoutRepository,
  workoutSessionRepository,
);

/** Sets or changes the run's training days, regenerating its calendar. */
export const configureTrainingDaysUseCase = new ConfigureTrainingDaysUseCase(
  programRepository,
  programEnrollmentRepository,
  plannedWorkoutRepository,
  workoutSessionRepository,
);

/** Moves one future planned workout of the run to another calendar date. */
export const reschedulePlannedWorkoutUseCase = new ReschedulePlannedWorkoutUseCase(
  programRepository,
  programEnrollmentRepository,
  plannedWorkoutRepository,
  workoutSessionRepository,
);
