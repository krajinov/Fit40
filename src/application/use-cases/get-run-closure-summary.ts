/**
 * Use case: the authenticated user's M17 run-closure summary for one program
 * run (M17 Slice 10).
 *
 * Read-only. Ownership is resolved server-side from the trusted `userId` plus
 * the program pair — the `GetEnrollmentFollowThroughUseCase` convention — so one
 * user can never read another user's run and no `EnrollmentId` is accepted. The
 * program aggregate is supplied by the caller, so a request that already
 * hydrated the program (the program detail page) loads the catalog once.
 *
 * The question this read answers is CLOSURE — not completion and not the
 * calendar:
 * - The denominator is the AUTHORED program occurrence set. Never
 *   `planned_workouts` rows (calendar intent, regenerated), never M16's 8-week
 *   report (a window over those rows), never user-global history.
 * - A run is *concluded* when every authored occurrence is settled by a
 *   completed session (M14) or an explicit not-performed record (M17) — and it
 *   may be concluded while INCOMPLETE, which is exactly the run of a user who
 *   did not train part of the plan.
 * - Completion stays `isProgramComplete` (M14) and never counts a
 *   not-performed record. Both verdicts arrive in the DTO; neither is
 *   re-decided here.
 *
 * Exactly two bounded, enrollment-scoped reads — the run's completed occurrence
 * ids and its recorded facts — issued together because neither decides whether
 * the other happens. No planned-row read, no session hydration, no catalog
 * query, and deliberately NO clock: conclusion is never a date consequence
 * (a future, today's and a past occurrence are all simply open until settled),
 * so this use case takes no `now`.
 *
 * Semantics are never re-decided here: counts and `isConcluded` come from the
 * Domain's `resolveRunClosure`, completion from `isProgramComplete`, and
 * restartability from the Domain's `isRunRestartable` — the single "complete OR
 * concluded" rule. It renders no judgement wording and no copy.
 *
 * `ok(null)` means there is no current enrollment: absence is data, never a
 * fabricated summary.
 */

import { toRunClosureSummaryDto, type RunClosureSummaryDto } from '@/application/dto/run-closure';
import type { NotPerformedOccurrenceRepository } from '@/application/ports/not-performed-occurrence-repository';
import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import type { WorkoutSessionRepository } from '@/application/ports/workout-session-repository';
import type { TrainingProgram } from '@/domain/entities/training-program';
import { isProgramComplete } from '@/domain/services/program-progress';
import { isRunRestartable, resolveRunClosure } from '@/domain/services/run-closure';
import { createUserId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type GetRunClosureSummaryError = {
  readonly code: 'INVALID_INPUT';
  readonly message: string;
  readonly field?: string;
};

export interface GetRunClosureSummaryInput {
  readonly userId: string;
  /**
   * The program aggregate the caller already loaded (e.g. the program detail
   * page's `GetProgramBySlugUseCase` result) — the authored denominator of the
   * closure this read resolves.
   */
  readonly program: TrainingProgram;
}

export class GetRunClosureSummaryUseCase {
  constructor(
    private readonly enrollmentRepository: ProgramEnrollmentRepository,
    private readonly sessionRepository: WorkoutSessionRepository,
    private readonly notPerformedRepository: NotPerformedOccurrenceRepository,
  ) {}

  async execute(
    input: GetRunClosureSummaryInput,
  ): Promise<Result<RunClosureSummaryDto | null, GetRunClosureSummaryError>> {
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

    // The run's own execution truth: completed occurrence ids (M14) and
    // recorded not-performed facts (M17). Independent reads, so they are
    // issued together; both are enrollment-scoped projections, never session
    // aggregates and never another run's (or detached) history.
    const [completedIds, notPerformedFacts] = await Promise.all([
      this.sessionRepository.listCompletedScheduledWorkoutIds(enrollment.id),
      this.notPerformedRepository.listByEnrollment(enrollment.id),
    ]);

    // Domain authority, evaluated exactly once each: closure over the authored
    // program, M14 completion untouched by the records, and the one
    // restartability rule composed from the two — never recomputed here.
    const closure = resolveRunClosure(input.program, {
      completedIds,
      notPerformedIds: notPerformedFacts.map((fact) => fact.scheduledWorkoutId),
    });
    const programComplete = isProgramComplete(input.program, completedIds);

    return ok(
      toRunClosureSummaryDto(input.program, closure, {
        programComplete,
        restartAvailable: isRunRestartable({
          programComplete,
          runConcluded: closure.isConcluded,
        }),
      }),
    );
  }
}
