/**
 * Composition root for the training-history feature.
 *
 * This is the single place where the concrete Drizzle repository is wired
 * into the history use cases. To replace an adapter, change only this file.
 */

import { GetCompletedSessionUseCase } from '@/application/use-cases/get-completed-session';
import { GetTrainingTotalsUseCase } from '@/application/use-cases/get-training-totals';
import { ListTrainingHistoryUseCase } from '@/application/use-cases/list-training-history';
import {
  exerciseRepository,
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
