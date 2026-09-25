/**
 * Composition root for the dashboard feature.
 *
 * The current-program dashboard use case is composed from the existing
 * feature-scoped use case instances; to replace an adapter, change the
 * feature composition roots this file builds on.
 */

import { GetCurrentProgramDashboardUseCase } from '@/application/use-cases/get-current-program-dashboard';
import { GetTrainingWeeklyInsightsUseCase } from '@/application/use-cases/get-training-weekly-insights';
import {
  exerciseRepository,
  personalRecordRepository,
  trainingHistoryRepository,
} from '@/infrastructure/database/repositories';
import {
  getProgramEnrollmentUseCase,
  listUserEnrollmentsUseCase,
} from '@/features/enrollment/services';
import { getProgramBySlugUseCase } from '@/features/programs/services';
import { resolveNextWorkoutUseCase } from '@/features/sessions/services';

export const getCurrentProgramDashboardUseCase = new GetCurrentProgramDashboardUseCase(
  listUserEnrollmentsUseCase,
  getProgramBySlugUseCase,
  getProgramEnrollmentUseCase,
  resolveNextWorkoutUseCase,
);

/**
 * Weekly insights use case (M13), composed beside the dashboard use case so
 * this feature owns its own wiring; the repositories are the shared Drizzle
 * singletons, exactly as the history feature composes its read models.
 */
export const getTrainingWeeklyInsightsUseCase = new GetTrainingWeeklyInsightsUseCase(
  trainingHistoryRepository,
  personalRecordRepository,
  exerciseRepository,
);
