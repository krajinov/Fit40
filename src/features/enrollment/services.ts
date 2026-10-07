/**
 * Composition root for the enrollment feature.
 *
 * This is the single place where the concrete Drizzle repositories are wired
 * into the enrollment use cases. To replace an adapter, change only this
 * file.
 */

import { EnrollInProgramUseCase } from '@/application/use-cases/enroll-in-program';
import { GetProgramCompletionSummaryUseCase } from '@/application/use-cases/get-program-completion-summary';
import { GetProgramEnrollmentUseCase } from '@/application/use-cases/get-program-enrollment';
import { LeaveProgramUseCase } from '@/application/use-cases/leave-program';
import { ListUserEnrollmentsUseCase } from '@/application/use-cases/list-user-enrollments';
import { RestartProgramUseCase } from '@/application/use-cases/restart-program';
import { NodeIdGenerator } from '@/infrastructure/crypto/node-id-generator';
import {
  exerciseRepository,
  personalRecordRepository,
  programEnrollmentRepository,
  programRepository,
  workoutSessionRepository,
} from '@/infrastructure/database/repositories';

const idGenerator = new NodeIdGenerator();

export const enrollInProgramUseCase = new EnrollInProgramUseCase(
  programRepository,
  programEnrollmentRepository,
  idGenerator,
);

export const leaveProgramUseCase = new LeaveProgramUseCase(
  programRepository,
  programEnrollmentRepository,
);

export const getProgramEnrollmentUseCase = new GetProgramEnrollmentUseCase(
  programEnrollmentRepository,
  workoutSessionRepository,
);

export const listUserEnrollmentsUseCase = new ListUserEnrollmentsUseCase(
  programEnrollmentRepository,
  programRepository,
);

/**
 * The M14 completion summary of the current enrollment (Slice 4). Composed
 * beside the enrollment read use cases: it reuses Slice 2's enrollment-scoped
 * completed-session read and the M12 personal-record pipeline, and adds no
 * persistence of its own.
 */
export const getProgramCompletionSummaryUseCase = new GetProgramCompletionSummaryUseCase(
  programRepository,
  programEnrollmentRepository,
  workoutSessionRepository,
  personalRecordRepository,
  exerciseRepository,
);

/**
 * The M14 restart of a completed program run (Slice 5). ONE write — Slice 3's
 * atomic compare-and-replace — so a failed restart can never leave the user
 * unenrolled, and the completed run's sessions survive as detached history.
 */
export const restartProgramUseCase = new RestartProgramUseCase(
  programRepository,
  programEnrollmentRepository,
  workoutSessionRepository,
  idGenerator,
);
