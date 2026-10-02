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
 * Exactly one bounded, enrollment-scoped snapshot read — the run's completed
 * occurrence ids AND its recorded facts together, through the closure-facts
 * projection port. A single coherent snapshot is required, not optional: two
 * independent statements could observe different database instants under READ
 * COMMITTED and manufacture a completed+not-performed overlap the persisted
 * state never held, which `resolveRunClosure` would (correctly) reject. No
 * planned-row read, no session hydration, no catalog query, and deliberately
 * NO clock: conclusion is never a date consequence (a future, today's and a
 * past occurrence are all simply open until settled), so this use case takes
 * no `now`.
 *
 * Semantics are never re-decided here: counts and `isConcluded` come from the
 * Domain's `resolveRunClosure`, completion from `isProgramComplete`, and
 * restartability from the Domain's `isRunRestartable` — the single "complete OR
 * concluded" rule. It renders no judgement wording and no copy.
 *
 * `ok(null)` means there is no current enrollment: absence is data, never a
 * fabricated summary.
 *
 * Enrollment identity fencing: a caller that already loaded a specific
 * enrollment (the dashboard, program detail) passes it as
 * `expectedEnrollmentId`, and the read is then FENCED to that identity — a
 * concurrent restart/leave that replaced the run (the expected row is deleted,
 * a rejoin creates a different id) yields the typed `ENROLLMENT_CHANGED`
 * refusal instead of silently switching to the NEW run's facts, which would
 * compose an old-enrollment DTO with new-run closure truth. The caller decides
 * the fallback (the parents degrade to no closure data); this read never
 * mixes enrollment generations.
 */

import { toRunClosureSummaryDto, type RunClosureSummaryDto } from '@/application/dto/run-closure';
import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import type { RunClosureFactsRepository } from '@/application/ports/run-closure-facts-repository';
import type { ProgramEnrollment } from '@/domain/entities/program-enrollment';
import type { TrainingProgram } from '@/domain/entities/training-program';
import { isProgramComplete } from '@/domain/services/program-progress';
import { isRunRestartable, resolveRunClosure } from '@/domain/services/run-closure';
import {
  createEnrollmentId,
  createUserId,
  type ProgramId,
  type UserId,
} from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type GetRunClosureSummaryError =
  | {
      readonly code: 'INVALID_INPUT';
      readonly message: string;
      readonly field?: string;
    }
  | {
      /**
       * The caller's expected enrollment no longer exists (a concurrent
       * restart/leave replaced the run): the read refuses to compose the caller's
       * old-enrollment DTO with a new run's facts. Never thrown — the caller
       * degrades (the parents report no closure data), never mixes generations.
       */
      readonly code: 'ENROLLMENT_CHANGED';
      readonly message: string;
    };

export interface GetRunClosureSummaryInput {
  readonly userId: string;
  /**
   * The program aggregate the caller already loaded (e.g. the program detail
   * page's `GetProgramBySlugUseCase` result) — the authored denominator of the
   * closure this read resolves.
   */
  readonly program: TrainingProgram;
  /**
   * The SPECIFIC enrollment the caller already loaded and is composing this
   * summary into (the dashboard's / program detail's enrollment view). When
   * supplied, the read is fenced to exactly that identity: it never re-resolves
   * the current enrollment, so a concurrent restart/leave cannot hand back the
   * NEW run's facts for an old-enrollment DTO. Omitted (or undefined), the read
   * resolves the current enrollment as before — the standalone read convention.
   */
  readonly expectedEnrollmentId?: string;
}

export class GetRunClosureSummaryUseCase {
  constructor(
    private readonly enrollmentRepository: ProgramEnrollmentRepository,
    private readonly closureFactsRepository: RunClosureFactsRepository,
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

    const enrollment =
      input.expectedEnrollmentId === undefined
        ? await this.resolveCurrentEnrollment(userIdResult.data, input.program.id)
        : await this.resolveFencedEnrollment(
            input.expectedEnrollmentId,
            userIdResult.data,
            input.program.id,
          );
    if ('error' in enrollment) {
      return err(enrollment.error);
    }
    if (enrollment.data === null) {
      return ok(null);
    }
    const resolvedEnrollment = enrollment.data;

    // The run's own execution truth from ONE coherent snapshot: completed
    // occurrence ids (M14) and recorded not-performed facts (M17), projected
    // together so a concurrent settlement transition can never manufacture an
    // authored occurrence that appears in both sets. Both sets are
    // enrollment-scoped projections, never session aggregates and never
    // another run's (or detached) history.
    const facts = await this.closureFactsRepository.listClosureFactsByEnrollment(resolvedEnrollment.id);

    // Domain authority, evaluated exactly once each: closure over the authored
    // program, M14 completion untouched by the records, and the one
    // restartability rule composed from the two — never recomputed here.
    const closure = resolveRunClosure(input.program, facts);
    const programComplete = isProgramComplete(input.program, facts.completedIds);

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

  /**
   * The standalone convention: the CURRENT enrollment of the trusted (user,
   * program) pair — `null` when the user is not enrolled (absence is data).
   */
  private async resolveCurrentEnrollment(
    userId: UserId,
    programId: ProgramId,
  ): Promise<{ readonly data: ProgramEnrollment | null }> {
    return { data: await this.enrollmentRepository.findByUserAndProgram(userId, programId) };
  }

  /**
   * The fenced path: EXACTLY the caller's expected enrollment, or the typed
   * `ENROLLMENT_CHANGED` refusal — never a silent switch to the current run.
   *
   * The expected id comes from the caller's own loaded DTO (never client
   * input), but it is still verified structurally: the row found by identity
   * must belong to the trusted (user, program) pair, so a foreign or stale id
   * can never leak another user's run. A vanished expected row (restart/leave
   * deleted it; a rejoin created a different id) is `ENROLLMENT_CHANGED`, not
   * absence: the caller is composing a DTO for a run that DID exist.
   */
  private async resolveFencedEnrollment(
    expectedEnrollmentId: string,
    userId: UserId,
    programId: ProgramId,
  ): Promise<
    | { readonly data: ProgramEnrollment | null }
    | { readonly error: Extract<GetRunClosureSummaryError, { readonly code: 'ENROLLMENT_CHANGED' }> }
  > {
    const expectedId = createEnrollmentId(expectedEnrollmentId);
    if (!expectedId.ok) {
      return {
        error: {
          code: 'ENROLLMENT_CHANGED',
          message: `The expected enrollment id is invalid, so the run's closure cannot be read`,
        },
      };
    }

    const enrollment = await this.enrollmentRepository.findById(expectedId.data);
    if (enrollment === null || enrollment.userId !== userId || enrollment.programId !== programId) {
      return {
        error: {
          code: 'ENROLLMENT_CHANGED',
          message:
            'Your enrollment changed while reading the run closure. Please reload and try again.',
        },
      };
    }

    return { data: enrollment };
  }
}
