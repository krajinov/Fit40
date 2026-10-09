/**
 * Composition root for the progress feature.
 *
 * The M18 activity read is composed here from the shared Drizzle repository
 * singletons — the same wiring the history and dashboard features use. To
 * replace an adapter, change only the shared repository module.
 */

import { GetTrainingProgressActivityUseCase } from '@/application/use-cases/get-training-progress-activity';
import { trainingHistoryRepository } from '@/infrastructure/database/repositories';

export const getTrainingProgressActivityUseCase = new GetTrainingProgressActivityUseCase(
  trainingHistoryRepository,
);
