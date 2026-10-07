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
 *
 * Fencing is ATOMIC: identity and facts come from ONE statement (the
 * closure-facts port's fenced projection), because validating the expected
 * enrollment with a read and then reading its facts is two statements - a
 * restart/leave committing between them would make the facts read observe a
 * run that no longer exists, and the resulting empty sets would render the
 * OLD authored program as a fully-open run instead of a refusal.
 */

import { toRunClosureSummaryDto, type RunClosureSummaryDto } from '@/application/dto/run-closure';
import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import type { RunClosureFactsRepository } from '@/application/ports/run-closure-facts-repository';
import type { ProgramEnrollment } from '@/domain/entities/program-enrollment';
import type { TrainingProgram } from '@/domain/entities/training-program';
import { isProgramComplete } from '@/domain/services/program-progress';
import {
  isRunRestartable,
  resolveRunClosure,
  type RunClosureFacts,
} from '@/domain/services/run-closure';
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

    // The fenced path: identity and facts in ONE statement - never a validate
    // call followed by an independent facts call, whose window a concurrent
    // restart/leave could open.
    if (input.expectedEnrollmentId !== undefined) {
      return this.summarizeFenced(input.expectedEnrollmentId, userIdResult.data, input.program);
    }

    const enrollment = await this.resolveCurrentEnrollment(
      userIdResult.data,
      input.program.id,
    );
    if (enrollment === null) {
      return ok(null);
    }

    // The run's own execution truth from ONE coherent snapshot: completed
    // occurrence ids (M14) and recorded not-performed facts (M17), projected
    // together so a concurrent settlement transition can never manufacture an
    // authored occurrence that appears in both sets. Both sets are
    // enrollment-scoped projections, never session aggregates and never
    // another run's (or detached) history.
    const facts = await this.closureFactsRepository.listClosureFactsByEnrollment(enrollment.id);

    return ok(this.buildSummary(input.program, facts));
  }

  /**
   * Domain authority over one coherent fact set, evaluated exactly once each:
   * closure over the authored program, M14 completion untouched by the records,
   * and the one restartability rule composed from the two — never recomputed
   * here. Shared by the standalone and fenced paths so both derive the SAME
   * verdicts from their own snapshot's facts.
   */
  private buildSummary(program: TrainingProgram, facts: RunClosureFacts): RunClosureSummaryDto {
    const closure = resolveRunClosure(program, facts);
    const programComplete = isProgramComplete(program, facts.completedIds);

    return toRunClosureSummaryDto(
      program,
      closure,
      {
        programComplete,
        restartAvailable: isRunRestartable({
          programComplete,
          runConcluded: closure.isConcluded,
        }),
      },
      // The SAME fact sets the verdicts were resolved from: the DTO's authored
      // settlement identities can never disagree with its counts, and
      // presentation never has to infer settlement from counts or from another
      // read's availability.
      facts,
    );
  }

  /**
   * The standalone convention: the CURRENT enrollment of the trusted (user,
   * program) pair — `null` when the user is not enrolled (absence is data).
   */
  private async resolveCurrentEnrollment(
    userId: UserId,
    programId: ProgramId,
  ): Promise<ProgramEnrollment | null> {
    return this.enrollmentRepository.findByUserAndProgram(userId, programId);
  }

  /**
   * The fenced read: ONE statement establishes BOTH that the caller's expected
   * enrollment is still this user's run of this program AND that run's facts.
   *
   * `matched: false` (gone, replaced, or not the trusted pair's — a foreign id
   * never leaks another user's run) is the typed `ENROLLMENT_CHANGED`, never
   * absence and never a summary: the caller is composing a DTO for a run that
   * DID exist, so an empty fact set must never be interpreted as a fresh, open
   * run. A malformed id is the same refusal.
   */
  private async summarizeFenced(
    expectedEnrollmentId: string,
    userId: UserId,
    program: TrainingProgram,
  ): Promise<Result<RunClosureSummaryDto | null, GetRunClosureSummaryError>> {
    const expectedId = createEnrollmentId(expectedEnrollmentId);
    if (!expectedId.ok) {
      return err({
        code: 'ENROLLMENT_CHANGED',
        message: `The expected enrollment id is invalid, so the closure cannot be read`,
      });
    }

    const projection = await this.closureFactsRepository.findFencedClosureFactsByEnrollment(
      expectedId.data,
      userId,
      program.id,
    );
    if (!projection.matched) {
      return err({
        code: 'ENROLLMENT_CHANGED',
        message:
          'Your enrollment changed while reading the run closure. Please reload and try again.',
      });
    }

    return ok(this.buildSummary(program, projection.facts));
  }
}
