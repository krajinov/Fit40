import { InMemoryProgramRepository } from '@/infrastructure/programs/in-memory-program-repository';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';
import { StartWorkoutSessionUseCase } from '@/application/use-cases/start-workout-session';
import { GetWorkoutSessionUseCase } from '@/application/use-cases/get-workout-session';
import { LogSessionSetUseCase } from '@/application/use-cases/log-session-set';
import { UpdateSessionSetUseCase } from '@/application/use-cases/update-session-set';
import { DeleteSessionSetUseCase } from '@/application/use-cases/delete-session-set';
import { CompleteWorkoutSessionUseCase } from '@/application/use-cases/complete-workout-session';

const programRepository = new InMemoryProgramRepository();
const sessionRepository = new InMemoryWorkoutSessionRepository();

export const startWorkoutSessionUseCase = new StartWorkoutSessionUseCase(
  programRepository,
  sessionRepository,
);

export const getWorkoutSessionUseCase = new GetWorkoutSessionUseCase(
  programRepository,
  sessionRepository,
);

export const logSessionSetUseCase = new LogSessionSetUseCase(sessionRepository);
export const updateSessionSetUseCase = new UpdateSessionSetUseCase(sessionRepository);
export const deleteSessionSetUseCase = new DeleteSessionSetUseCase(sessionRepository);
export const completeWorkoutSessionUseCase = new CompleteWorkoutSessionUseCase(sessionRepository);