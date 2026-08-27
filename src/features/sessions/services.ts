import { StartWorkoutSessionUseCase } from '@/application/use-cases/start-workout-session';
import { GetWorkoutSessionUseCase } from '@/application/use-cases/get-workout-session';
import { LogSessionSetUseCase } from '@/application/use-cases/log-session-set';
import { UpdateSessionSetUseCase } from '@/application/use-cases/update-session-set';
import { DeleteSessionSetUseCase } from '@/application/use-cases/delete-session-set';
import { CompleteWorkoutSessionUseCase } from '@/application/use-cases/complete-workout-session';
import { programRepository, workoutSessionRepository } from '@/infrastructure/database/repositories';

export const startWorkoutSessionUseCase = new StartWorkoutSessionUseCase(
  programRepository,
  workoutSessionRepository,
);

export const getWorkoutSessionUseCase = new GetWorkoutSessionUseCase(
  programRepository,
  workoutSessionRepository,
);

export const logSessionSetUseCase = new LogSessionSetUseCase(workoutSessionRepository);
export const updateSessionSetUseCase = new UpdateSessionSetUseCase(workoutSessionRepository);
export const deleteSessionSetUseCase = new DeleteSessionSetUseCase(workoutSessionRepository);
export const completeWorkoutSessionUseCase = new CompleteWorkoutSessionUseCase(workoutSessionRepository);