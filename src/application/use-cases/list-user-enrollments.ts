/**
 * Use case: list the authenticated user's program enrollments.
 *
 * Read-only. The userId must come from the trusted authenticated session at
 * the presentation layer, never from client input. An invalid id is a caller
 * bug and yields an empty list, mirroring how GetUserProfileUseCase treats an
 * unresolvable id as absence.
 */

import type { EnrollmentSummaryDto } from '@/application/dto/enrollment';
import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';
import { createUserId } from '@/domain/types/ids';

export class ListUserEnrollmentsUseCase {
  constructor(
    private readonly enrollmentRepository: ProgramEnrollmentRepository,
    private readonly programRepository: ProgramRepository,
  ) {}

  async execute(userId: string): Promise<ReadonlyArray<EnrollmentSummaryDto>> {
    const idResult = createUserId(userId);
    if (!idResult.ok) {
      return [];
    }

    const enrollments = await this.enrollmentRepository.listByUserId(idResult.data);
    if (enrollments.length === 0) {
      return [];
    }

    const programs = await this.programRepository.list();
    const programsById = new Map(programs.map((program) => [program.id, program]));

    const summaries: EnrollmentSummaryDto[] = [];
    for (const enrollment of enrollments) {
      const program = programsById.get(enrollment.programId);
      // program_id is a RESTRICT foreign key, so an orphaned enrollment
      // cannot exist; skip defensively rather than failing the whole list.
      if (program === undefined) {
        continue;
      }
      summaries.push({
        programId: enrollment.programId,
        programSlug: program.slug,
        programName: program.name,
        enrolledAt: enrollment.enrolledAt.toISOString(),
      });
    }

    return summaries;
  }
}
