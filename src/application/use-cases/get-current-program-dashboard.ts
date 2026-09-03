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

import type { CurrentProgramDashboardDto } from '@/application/dto/dashboard';
import type { GetProgramBySlugUseCase } from '@/application/use-cases/get-program-by-slug';
import type { GetProgramEnrollmentUseCase } from '@/application/use-cases/get-program-enrollment';
import type { ListUserEnrollmentsUseCase } from '@/application/use-cases/list-user-enrollments';
import type { ResolveNextWorkoutUseCase } from '@/application/use-cases/resolve-next-workout';
import { err, ok, type Result } from '@/domain/types/result';

export type GetCurrentProgramDashboardError =
  | { readonly code: 'CURRENT_PROGRAM_UNRESOLVABLE'; readonly message: string };

export class GetCurrentProgramDashboardUseCase {
  constructor(
    private readonly listUserEnrollments: Pick<ListUserEnrollmentsUseCase, 'execute'>,
    private readonly getProgramBySlug: Pick<GetProgramBySlugUseCase, 'execute'>,
    private readonly getProgramEnrollment: Pick<GetProgramEnrollmentUseCase, 'execute'>,
    private readonly resolveNextWorkout: Pick<ResolveNextWorkoutUseCase, 'execute'>,
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

    return ok({
      program: programResult.data.detail,
      enrollment,
      nextWorkout,
    });
  }
}
