/**
 * Composition root for the profile feature.
 *
 * This is the single place where the concrete Drizzle repository is wired
 * into the application use cases. To replace an adapter, change only this file.
 */

import { CompleteOnboardingUseCase } from '@/application/use-cases/complete-onboarding';
import { GetUserProfileUseCase } from '@/application/use-cases/get-user-profile';
import { UpdateUserProfileUseCase } from '@/application/use-cases/update-user-profile';
import { userProfileRepository } from '@/infrastructure/database/repositories';

export const getUserProfileUseCase = new GetUserProfileUseCase(userProfileRepository);
export const completeOnboardingUseCase = new CompleteOnboardingUseCase(userProfileRepository);
export const updateUserProfileUseCase = new UpdateUserProfileUseCase(userProfileRepository);
