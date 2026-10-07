/**
 * Use case: assemble the dashboard's current-program view.
 *
 * Ported from the presentation-layer dashboard view assembly (PR #9 P1):
 * selecting the user's current program — the most recently joined
 * enrollment, as the enrollment repository lists enrollments by enrollment
 * time ascending — and hydrating it with program detail, per-enrollment
 * progress and next-workout state is application orchestration, not
 * presentation.
 *
 * Read-only. The userId must come from the trusted authenticated session at
 * the presentation layer, never from client input.
 */

import type {
  CurrentProgramDashboardDto,
  DashboardScheduleState,
} from '@/application/dto/dashboard';
import type { RunClosureSummaryDto } from '@/application/dto/run-closure';
import type { GetEnrollmentScheduleUseCase } from '@/application/use-cases/get-enrollment-schedule';
import type { GetProgramBySlugUseCase } from '@/application/use-cases/get-program-by-slug';
import type { GetProgramEnrollmentUseCase } from '@/application/use-cases/get-program-enrollment';
import type { GetRunClosureSummaryUseCase } from '@/application/use-cases/get-run-closure-summary';
import type { ListUserEnrollmentsUseCase } from '@/application/use-cases/list-user-enrollments';
import type { ResolveNextWorkoutUseCase } from '@/application/use-cases/resolve-next-workout';
import type { TrainingProgram } from '@/domain/entities/training-program';
import { err, ok, type Result } from '@/domain/types/result';

export type GetCurrentProgramDashboardError =
  | { readonly code: 'CURRENT_PROGRAM_UNRESOLVABLE'; readonly message: string };

export class GetCurrentProgramDashboardUseCase {
  constructor(
    private readonly listUserEnrollments: Pick<ListUserEnrollmentsUseCase, 'execute'>,
    private readonly getProgramBySlug: Pick<GetProgramBySlugUseCase, 'execute'>,
    private readonly getProgramEnrollment: Pick<GetProgramEnrollmentUseCase, 'execute'>,
    private readonly resolveNextWorkout: Pick<ResolveNextWorkoutUseCase, 'execute'>,
    private readonly getEnrollmentSchedule: Pick<GetEnrollmentScheduleUseCase, 'execute'>,
    /**
     * The M17 closure read (Slice 10), composed here so the dashboard can expose
     * the run's authoritative open-occurrence truth — the completion-only
     * `nextWorkout` cannot distinguish a recorded occurrence from an open one.
     */
    private readonly getRunClosureSummary: Pick<GetRunClosureSummaryUseCase, 'execute'>,
  ) {}

  /**
   * Returns `ok(null)` when the user has no enrollments (the dashboard
   * renders its empty states). Returns a typed error when an enrollment
   * exists but its program, per-enrollment progress or state cannot be
   * resolved — the caller decides how to degrade; a next workout that
   * cannot be resolved degrades to null (no "Up next" card), mirroring the
   * presentation behavior this use case replaces.
   */
  async execute(
    userId: string,
    /**
     * The request clock (M15): the schedule's "today" is this instant's UTC
     * calendar day. The presentation layer captures it once per request —
     * application logic never calls `Date.now()`/`new Date()` itself.
     */
    now: Date,
  ): Promise<Result<CurrentProgramDashboardDto | null, GetCurrentProgramDashboardError>> {
    const enrollments = await this.listUserEnrollments.execute(userId);
    const latest = enrollments.at(-1);
    if (latest === undefined) {
      return ok(null);
    }

    const programResult = await this.getProgramBySlug.execute(latest.programSlug);
    if (!programResult.ok) {
      return err({
        code: 'CURRENT_PROGRAM_UNRESOLVABLE',
        message: `Enrolled program "${latest.programSlug}" could not be loaded`,
      });
    }

    const enrollmentResult = await this.getProgramEnrollment.execute({
      userId,
      program: programResult.data.program,
    });
    if (!enrollmentResult.ok) {
      return err({
        code: 'CURRENT_PROGRAM_UNRESOLVABLE',
        message: `Enrollment state for program "${latest.programSlug}" could not be resolved`,
      });
    }
    const enrollment = enrollmentResult.data;
    if (enrollment.status !== 'enrolled') {
      return err({
        code: 'CURRENT_PROGRAM_UNRESOLVABLE',
        message: `Enrollment for program "${latest.programSlug}" is missing despite being listed`,
      });
    }

    const nextWorkout =
      enrollment.nextWorkout === null
        ? null
        : await this.resolveNextWorkout.execute({
            userId,
            programSlug: programResult.data.program.slug,
            weekNumber: enrollment.nextWorkout.weekNumber,
            workoutOrder: enrollment.nextWorkout.workoutOrder,
            // The SAME generation fence the schedule and closure reads use: the
            // preview's session state is resolved for EXACTLY the enrollment
            // this view already loaded, never the replacement run.
            expectedEnrollmentId: enrollment.enrollmentId,
          });

    // M15 (Slice 5) calendar + M17 (Slice 10) closure truth: two independent
    // additive reads, issued together. The closure read is a bounded,
    // enrollment-scoped pair (completed ids + recorded facts) that lets the
    // dashboard resolve the run's first OPEN occurrence; a failure degrades to
    // null, never to fabricated settlement truth.
    const [schedule, runClosure] = await Promise.all([
      this.readSchedule(
        userId,
        programResult.data.program,
        now,
        programResult.data.program.slug,
        // The SAME generation fence the closure read uses: the schedule is read
        // for EXACTLY the enrollment this view already loaded.
        enrollment.enrollmentId,
      ),
      this.readRunClosure(
        userId,
        programResult.data.program,
        programResult.data.program.slug,
        enrollment.enrollmentId,
      ),
    ]);

    return ok({
      program: programResult.data.detail,
      enrollment,
      nextWorkout,
      runClosure,
      schedule,
    });
  }

  /**
   * Reads the run's M17 closure summary (Slice 10) with the SAME already-hydrated
   * program aggregate AND the SAME enrollment this view already loaded — the
   * read is fenced to that identity (`expectedEnrollmentId`), so a concurrent
   * restart/leave cannot compose this view's old-enrollment data with a new
   * run's closure facts. No second catalog lookup and no clock: conclusion is
   * not a date consequence.
   *
   * Failure (typed refusal, typed rejection or unexpected throw) degrades to
   * `null`, never to fabricated counts: a failed additive read must not invent
   * settlement truth, and per docs/error-handling.md a caught error is always
   * logged. A `null` DTO means there is no current enrollment, or the expected
   * enrollment vanished/was replaced between this view's reads — absence and
   * staleness are both data, and the view degrades exactly the same way.
   */
  private async readRunClosure(
    userId: string,
    program: TrainingProgram,
    programSlug: string,
    expectedEnrollmentId: string,
  ): Promise<RunClosureSummaryDto | null> {
    try {
      const result = await this.getRunClosureSummary.execute({
        userId,
        program,
        expectedEnrollmentId,
      });
      if (!result.ok) {
        console.error(
          `Unexpected failure reading the run closure for program "${programSlug}"`,
          result.error,
        );
        return null;
      }
      return result.data;
    } catch (error: unknown) {
      console.error(
        `Unexpected failure reading the run closure for program "${programSlug}"`,
        error,
      );
      return null;
    }
  }

  /**
   * Reads the run's M15 training calendar with the SAME hydrated program
   * aggregate AND the SAME enrollment this view already loaded — the read is
   * fenced to that identity (`expectedEnrollmentId`), so a concurrent
   * restart/leave cannot compose this view's old-enrollment data with a new
   * run's calendar.
   *
   * Failure - including the typed `ENROLLMENT_CHANGED` refusal - degrades to
   * `{ status: 'unavailable' }`, never to "unconfigured": a failed or
   * stale-generation read must not be rendered as an unset schedule. Per
   * docs/error-handling.md a caught error is always logged, mirroring the
   * dashboard's optional-read convention (M13 insights, recent training). A
   * `null` schedule means the enrollment vanished between this use case's own
   * reads (a concurrent leave) - also `unavailable`, never an unconfigured run.
   */
  private async readSchedule(
    userId: string,
    program: TrainingProgram,
    now: Date,
    programSlug: string,
    expectedEnrollmentId: string,
  ): Promise<DashboardScheduleState> {
    try {
      const result = await this.getEnrollmentSchedule.execute({
        userId,
        program,
        now,
        expectedEnrollmentId,
      });
      if (!result.ok) {
        console.error(
          `Unexpected failure reading the training schedule for program "${programSlug}"`,
          result.error,
        );
        return { status: 'unavailable' };
      }
      if (result.data === null) {
        console.error(
          `Training schedule for program "${programSlug}" became unreadable: the enrollment no longer exists`,
        );
        return { status: 'unavailable' };
      }
      return { status: 'loaded', schedule: result.data };
    } catch (error: unknown) {
      console.error(`Unexpected failure reading the training schedule for program "${programSlug}"`, error);
      return { status: 'unavailable' };
    }
  }
}
