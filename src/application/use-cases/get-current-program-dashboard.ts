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
import type { GetEnrollmentScheduleUseCase } from '@/application/use-cases/get-enrollment-schedule';
import type { GetProgramBySlugUseCase } from '@/application/use-cases/get-program-by-slug';
import type { GetProgramEnrollmentUseCase } from '@/application/use-cases/get-program-enrollment';
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
          });

    const schedule = await this.readSchedule(
      userId,
      programResult.data.program,
      now,
      programResult.data.program.slug,
    );

    return ok({
      program: programResult.data.detail,
      enrollment,
      nextWorkout,
      schedule,
    });
  }

  /**
   * Reads the run's M15 training calendar with the SAME hydrated program
   * aggregate as the rest of this view — the schedule use case takes the
   * aggregate precisely so one request hydrates the catalog exactly once.
   *
   * Failure degrades to `{ status: 'unavailable' }`, never to "unconfigured":
   * a failed read must not be rendered as an unset schedule. Per
   * docs/error-handling.md a caught error is always logged, mirroring the
   * dashboard's optional-read convention (M13 insights, recent training). A
   * `null` schedule means the enrollment vanished between this use case's own
   * reads (a concurrent leave) — that is also reported as `unavailable`, not
   * as an unconfigured run.
   */
  private async readSchedule(
    userId: string,
    program: TrainingProgram,
    now: Date,
    programSlug: string,
  ): Promise<DashboardScheduleState> {
    try {
      const result = await this.getEnrollmentSchedule.execute({ userId, program, now });
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
