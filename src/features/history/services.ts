/**
 * Composition root for the training-history feature.
 *
 * This is the single place where the concrete Drizzle repository is wired
 * into the history use cases. To replace an adapter, change only this file.
 */

import { GetCompletedSessionRecordEventsUseCase } from '@/application/use-cases/get-completed-session-record-events';
import { GetCompletedSessionUseCase } from '@/application/use-cases/get-completed-session';
import { GetExerciseHistoryUseCase } from '@/application/use-cases/get-exercise-history';
import { GetExercisesByIdsUseCase } from '@/application/use-cases/get-exercises-by-ids';
import { GetTrainingTotalsUseCase } from '@/application/use-cases/get-training-totals';
import { ListTrainingHistoryUseCase } from '@/application/use-cases/list-training-history';
import {
  exerciseRepository,
  personalRecordRepository,
  trainingHistoryRepository,
} from '@/infrastructure/database/repositories';

export const listTrainingHistoryUseCase = new ListTrainingHistoryUseCase(
  trainingHistoryRepository,
);

export const getTrainingTotalsUseCase = new GetTrainingTotalsUseCase(
  trainingHistoryRepository,
);

export const getCompletedSessionUseCase = new GetCompletedSessionUseCase(
  trainingHistoryRepository,
  exerciseRepository,
);

/**
 * Historical record events of one completed session (M12 Slice 4). Composed
 * beside — never inside — the completed-session use case, so the detail
 * screen's core read contract stays free of record semantics.
 */
export const getCompletedSessionRecordEventsUseCase =
  new GetCompletedSessionRecordEventsUseCase(
    trainingHistoryRepository,
    personalRecordRepository,
  );

export const getExerciseHistoryUseCase = new GetExerciseHistoryUseCase(
  trainingHistoryRepository,
  exerciseRepository,
  personalRecordRepository,
);

/**
 * Batched catalog resolution for the history screen's "recently trained
 * exercises" shortcuts. The screen already holds the performed exercise ids
 * of the page it loaded, so one batched lookup renders names and links with
 * no per-id query (no N+1) and no catalog-list over-fetch.
 */
export const getExercisesByIdsUseCase = new GetExercisesByIdsUseCase(exerciseRepository);
