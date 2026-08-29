/**
 * Composition root for the enrollment feature.
 *
 * This is the single place where the concrete Drizzle repositories are wired
 * into the enrollment use cases. To replace an adapter, change only this
 * file.
 */

import { EnrollInProgramUseCase } from '@/application/use-cases/enroll-in-program';
import { GetProgramEnrollmentUseCase } from '@/application/use-cases/get-program-enrollment';
import { LeaveProgramUseCase } from '@/application/use-cases/leave-program';
import { ListUserEnrollmentsUseCase } from '@/application/use-cases/list-user-enrollments';
import { NodeIdGenerator } from '@/infrastructure/crypto/node-id-generator';
import {
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
  programRepository,
  programEnrollmentRepository,
  workoutSessionRepository,
);

export const listUserEnrollmentsUseCase = new ListUserEnrollmentsUseCase(
  programEnrollmentRepository,
  programRepository,
);
