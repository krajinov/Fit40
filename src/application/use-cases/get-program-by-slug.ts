/**
 * Use case: retrieve a single training program by slug, including its schedule.
 */

import type { ProgramRepository } from '@/application/ports/program-repository';
import type {
  ProgramDetailDto,
  ProgramScheduledWorkoutDto,
  ProgramWeekDto,
} from '@/application/dto/program';
import type { ProgramWeek, TrainingProgram } from '@/domain/entities/training-program';
import { err, ok, type Result } from '@/domain/types/result';

export interface ProgramNotFoundError {
  readonly code: 'PROGRAM_NOT_FOUND';
  readonly slug: string;
  readonly message: string;
}

/**
 * The loaded program aggregate plus its presentation DTO. Returning the
 * aggregate lets a single request reuse the hydration (e.g. the program
 * detail page also resolves enrollment state) instead of re-querying the
 * catalog through a second repository call.
 */
export interface ProgramDetailResult {
  readonly detail: ProgramDetailDto;
  readonly program: TrainingProgram;
}

function toScheduledWorkoutDto(
  program: TrainingProgram,
  scheduled: ProgramWeek['scheduledWorkouts'][number],
): ProgramScheduledWorkoutDto {
  const workout = program.workouts.find((w) => w.id === scheduled.workoutId);
  // Domain invariant guarantees the template exists; fallback is defensive.
  const workoutName = workout?.name ?? 'Unknown workout';
  const workoutSlug = workout?.slug ?? '';

  return {
    scheduledWorkoutId: scheduled.id,
    workoutId: scheduled.workoutId,
    workoutName,
    workoutSlug,
    order: scheduled.order,
    estimatedDurationMinutes: workout?.estimatedDurationMinutes ?? 0,
  };
}

function toWeekDto(program: TrainingProgram, week: ProgramWeek): ProgramWeekDto {
  return {
    weekNumber: week.weekNumber,
    scheduledWorkouts: week.scheduledWorkouts
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((scheduled) => toScheduledWorkoutDto(program, scheduled)),
  };
}

function toDetailDto(program: TrainingProgram): ProgramDetailDto {
  return {
    id: program.id,
    name: program.name,
    slug: program.slug,
    description: program.description,
    difficulty: program.difficulty,
    goal: program.goal,
    durationWeeks: program.durationWeeks,
    workoutsPerWeek: program.workoutsPerWeek,
    weeks: program.weeks.map((week) => toWeekDto(program, week)),
  };
}

export class GetProgramBySlugUseCase {
  constructor(private readonly programRepository: ProgramRepository) {}

  async execute(slug: string): Promise<Result<ProgramDetailResult, ProgramNotFoundError>> {
    const program = await this.programRepository.findBySlug(slug);

    if (program === null) {
      return err({
        code: 'PROGRAM_NOT_FOUND',
        slug,
        message: `Program "${slug}" not found`,
      });
    }

    return ok({ detail: toDetailDto(program), program });
  }
}