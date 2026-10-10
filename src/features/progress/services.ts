/**
 * Composition root for the progress feature.
 *
 * The M18 reads are composed here from the shared Drizzle repository
 * singletons — the same wiring the history and dashboard features use. To
 * replace an adapter, change only the shared repository module.
 */

import { GetTrainingProgressActivityUseCase } from '@/application/use-cases/get-training-progress-activity';
import { GetTrainingProgressRecordEventsUseCase } from '@/application/use-cases/get-training-progress-record-events';
import {
  exerciseRepository,
  personalRecordRepository,
  trainingHistoryRepository,
} from '@/infrastructure/database/repositories';

export const getTrainingProgressActivityUseCase = new GetTrainingProgressActivityUseCase(
  trainingHistoryRepository,
);

/**
 * The historical PR-event read (M18 Slice 5) needs the three ports its
 * pipeline uses: the horizon's completed sessions, the exact prior-best read,
 * and the catalog for display names.
 */
export const getTrainingProgressRecordEventsUseCase =
  new GetTrainingProgressRecordEventsUseCase(
    trainingHistoryRepository,
    personalRecordRepository,
    exerciseRepository,
  );

