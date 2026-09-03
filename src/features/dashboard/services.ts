/**
 * Composition root for the dashboard feature.
 *
 * The current-program dashboard use case is composed from the existing
 * feature-scoped use case instances; to replace an adapter, change the
 * feature composition roots this file builds on.
 */

import { GetCurrentProgramDashboardUseCase } from '@/application/use-cases/get-current-program-dashboard';
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
