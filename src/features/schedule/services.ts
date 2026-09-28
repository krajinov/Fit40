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
import { GetEnrollmentFollowThroughUseCase } from '@/application/use-cases/get-enrollment-follow-through';
import { GetEnrollmentScheduleUseCase } from '@/application/use-cases/get-enrollment-schedule';
import { RecordNotPerformedUseCase } from '@/application/use-cases/record-not-performed';
import { ReschedulePlannedWorkoutUseCase } from '@/application/use-cases/reschedule-planned-workout';
import { UndoNotPerformedUseCase } from '@/application/use-cases/undo-not-performed';
import {
  notPerformedOccurrenceRepository,
  plannedWorkoutRepository,
  programEnrollmentRepository,
  programRepository,
  runOccurrenceWrites,
  workoutSessionRepository,
} from '@/infrastructure/database/repositories';

/**
 * The run's training calendar (planned dates, statuses and focus). Read-only:
 * the caller passes the program aggregate it already loaded, so one request
 * hydrates the program exactly once. The recorded-not-performed facts are read
 * through the read-only `NotPerformedOccurrenceRepository` — this read never
 * touches the write authority.
 */
export const getEnrollmentScheduleUseCase = new GetEnrollmentScheduleUseCase(
  programEnrollmentRepository,
  plannedWorkoutRepository,
  workoutSessionRepository,
  notPerformedOccurrenceRepository,
);

/**
 * The run's plan follow-through (M16): the last 8 UTC weeks of calendar intent
 * reconciled with session facts. Read-only, and like the schedule read the
 * caller passes the program aggregate it already loaded, so one request
 * hydrates the program exactly once.
 */
export const getEnrollmentFollowThroughUseCase = new GetEnrollmentFollowThroughUseCase(
  programEnrollmentRepository,
  plannedWorkoutRepository,
  workoutSessionRepository,
  notPerformedOccurrenceRepository,
);

/** Sets or changes the run's training days, regenerating its calendar. */
export const configureTrainingDaysUseCase = new ConfigureTrainingDaysUseCase(
  programRepository,
  programEnrollmentRepository,
  plannedWorkoutRepository,
  workoutSessionRepository,
  notPerformedOccurrenceRepository,
);

/** Moves one future planned workout of the run to another calendar date. */
export const reschedulePlannedWorkoutUseCase = new ReschedulePlannedWorkoutUseCase(
  programRepository,
  programEnrollmentRepository,
  plannedWorkoutRepository,
  workoutSessionRepository,
  notPerformedOccurrenceRepository,
);

/**
 * Records / undoes the run's not-performed settlement (M17). Both delegate to
 * the SAME `DrizzleRunOccurrenceWrites` singleton that creates workout sessions,
 * so record, undo and start serialize on one enrollment lock; constructing a
 * second instance here would be a second mutation authority.
 */
export const recordNotPerformedUseCase = new RecordNotPerformedUseCase(
  programRepository,
  programEnrollmentRepository,
  runOccurrenceWrites,
);

export const undoNotPerformedUseCase = new UndoNotPerformedUseCase(
  programRepository,
  programEnrollmentRepository,
  runOccurrenceWrites,
);
