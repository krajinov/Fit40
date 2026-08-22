/**
 * Use case: list all training programs.
 *
 * No expected failure path exists for listing, so this returns the array directly.
 */

import type { ProgramRepository } from '@/application/ports/program-repository';
import type { ProgramSummaryDto } from '@/application/dto/program';
import type { TrainingProgram } from '@/domain/entities/training-program';

function toSummaryDto(program: TrainingProgram): ProgramSummaryDto {
  return {
    id: program.id,
    name: program.name,
    slug: program.slug,
    description: program.description,
    difficulty: program.difficulty,
    goal: program.goal,
    durationWeeks: program.durationWeeks,
    workoutsPerWeek: program.workoutsPerWeek,
  };
}

export class ListProgramsUseCase {
  constructor(private readonly programRepository: ProgramRepository) {}

  async execute(): Promise<ReadonlyArray<ProgramSummaryDto>> {
    const programs = await this.programRepository.list();
    return programs.map(toSummaryDto);
  }
}