import { CompleteWorkoutSessionUseCase } from '@/application/use-cases/complete-workout-session';
import { AddSessionExerciseUseCase } from '@/application/use-cases/add-session-exercise';
import { DeleteSessionSetUseCase } from '@/application/use-cases/delete-session-set';
import { GetActiveWorkoutExerciseDataUseCase } from '@/application/use-cases/get-active-workout-exercise-data';
import { GetNextExerciseTargetsUseCase } from '@/application/use-cases/get-next-exercise-targets';
import { GetWorkoutSessionUseCase } from '@/application/use-cases/get-workout-session';
import { LogSessionSetUseCase } from '@/application/use-cases/log-session-set';
import { MoveSessionExerciseUseCase } from '@/application/use-cases/move-session-exercise';
import { ResolveNextWorkoutUseCase } from '@/application/use-cases/resolve-next-workout';
import { RestoreSessionExerciseUseCase } from '@/application/use-cases/restore-session-exercise';
import { SkipSessionExerciseUseCase } from '@/application/use-cases/skip-session-exercise';
import { StartWorkoutSessionUseCase } from '@/application/use-cases/start-workout-session';
import { SubstituteSessionExerciseUseCase } from '@/application/use-cases/substitute-session-exercise';
import { UnskipSessionExerciseUseCase } from '@/application/use-cases/unskip-session-exercise';
import { UpdateSessionSetUseCase } from '@/application/use-cases/update-session-set';
import { NodeIdGenerator } from '@/infrastructure/crypto/node-id-generator';
import { getScheduledWorkoutUseCase } from '@/features/programs/services';
import {
  exerciseRepository,
  programEnrollmentRepository,
  programRepository,
  trainingHistoryRepository,
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
  trainingHistoryRepository,
);

export const substituteSessionExerciseUseCase = new SubstituteSessionExerciseUseCase(
  workoutSessionRepository,
  exerciseRepository,
);

export const restoreSessionExerciseUseCase = new RestoreSessionExerciseUseCase(
  workoutSessionRepository,
);

export const skipSessionExerciseUseCase = new SkipSessionExerciseUseCase(
  workoutSessionRepository,
);

export const unskipSessionExerciseUseCase = new UnskipSessionExerciseUseCase(
  workoutSessionRepository,
);

export const moveSessionExerciseUseCase = new MoveSessionExerciseUseCase(
  workoutSessionRepository,
);

export const addSessionExerciseUseCase = new AddSessionExerciseUseCase(
  workoutSessionRepository,
  exerciseRepository,
);

export const getActiveWorkoutExerciseDataUseCase = new GetActiveWorkoutExerciseDataUseCase(
  exerciseRepository,
);

export const resolveNextWorkoutUseCase = new ResolveNextWorkoutUseCase(
  getScheduledWorkoutUseCase,
  getWorkoutSessionUseCase,
);
