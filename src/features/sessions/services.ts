import { CompleteWorkoutSessionUseCase } from '@/application/use-cases/complete-workout-session';
import { DeleteSessionSetUseCase } from '@/application/use-cases/delete-session-set';
import { GetNextExerciseTargetsUseCase } from '@/application/use-cases/get-next-exercise-targets';
import { GetWorkoutSessionUseCase } from '@/application/use-cases/get-workout-session';
import { LogSessionSetUseCase } from '@/application/use-cases/log-session-set';
import { ResolveNextWorkoutUseCase } from '@/application/use-cases/resolve-next-workout';
import { StartWorkoutSessionUseCase } from '@/application/use-cases/start-workout-session';
import { UpdateSessionSetUseCase } from '@/application/use-cases/update-session-set';
import { NodeIdGenerator } from '@/infrastructure/crypto/node-id-generator';
import { getScheduledWorkoutUseCase } from '@/features/programs/services';
import {
  exerciseRepository,
  programEnrollmentRepository,
  programRepository,
  workoutSessionRepository,
} from '@/infrastructure/database/repositories';

const idGenerator = new NodeIdGenerator();

export const startWorkoutSessionUseCase = new StartWorkoutSessionUseCase(
  programRepository,
  workoutSessionRepository,
  programEnrollmentRepository,
  idGenerator,
);

export const getWorkoutSessionUseCase = new GetWorkoutSessionUseCase(
  programRepository,
  workoutSessionRepository,
  programEnrollmentRepository,
);

export const logSessionSetUseCase = new LogSessionSetUseCase(workoutSessionRepository);
export const updateSessionSetUseCase = new UpdateSessionSetUseCase(workoutSessionRepository);
export const deleteSessionSetUseCase = new DeleteSessionSetUseCase(workoutSessionRepository);
export const completeWorkoutSessionUseCase = new CompleteWorkoutSessionUseCase(
  workoutSessionRepository,
  programRepository,
);

export const getNextExerciseTargetsUseCase = new GetNextExerciseTargetsUseCase(
  exerciseRepository,
  workoutSessionRepository,
);

export const resolveNextWorkoutUseCase = new ResolveNextWorkoutUseCase(
  getScheduledWorkoutUseCase,
  getWorkoutSessionUseCase,
);
