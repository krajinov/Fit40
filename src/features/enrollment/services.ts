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
import { GetRunClosureSummaryUseCase } from '@/application/use-cases/get-run-closure-summary';
import { LeaveProgramUseCase } from '@/application/use-cases/leave-program';
import { ListUserEnrollmentsUseCase } from '@/application/use-cases/list-user-enrollments';
import { RestartProgramUseCase } from '@/application/use-cases/restart-program';
import { NodeIdGenerator } from '@/infrastructure/crypto/node-id-generator';
import {
  exerciseRepository,
  personalRecordRepository,
  programEnrollmentRepository,
  programRepository,
  runClosureFactsRepository,
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
 * The M17 run-closure summary of the current run (Slice 10). Composed beside
 * the enrollment read use cases: it resolves ownership the same way, reads the
 * run's completed occurrence ids and recorded not-performed facts through ONE
 * coherent snapshot port (the closure-facts projection — never two independent
 * statements that could tear across a concurrent settlement transition), and
 * derives every verdict from the Domain — no persistence of its own, and no
 * influence on the M14 completion summary above.
 */
export const getRunClosureSummaryUseCase = new GetRunClosureSummaryUseCase(
  programEnrollmentRepository,
  runClosureFactsRepository,
);

/**
 * The M14 restart of a finished program run (Slice 5, widened by M17 Slice 10).
 * ONE write — Slice 3's atomic compare-and-replace — so a failed restart can
 * never leave the user unenrolled; the completed run's sessions survive as
 * detached history and its not-performed facts cascade with the old
 * enrollment. The eligibility gate is the Domain's `isRunRestartable`.
 */
export const restartProgramUseCase = new RestartProgramUseCase(
  programRepository,
  programEnrollmentRepository,
  runClosureFactsRepository,
  idGenerator,
);
