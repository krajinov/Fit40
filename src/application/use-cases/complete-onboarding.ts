/**
 * Use case: complete fitness onboarding for an authenticated user.
 *
 * Creates the user's single UserProfile. A friendly preflight check rejects an
 * already-completed onboarding, and the profile primary key remains the final
 * authority for concurrent double-submits: a racing insert is caught from the
 * repository and mapped to the same PROFILE_ALREADY_EXISTS outcome without
 * leaking PostgreSQL details.
 *
 * The userId must come from the trusted authenticated session at the
 * presentation layer, never from client form data.
 */

import {
  ProfileAlreadyExistsError,
  type UserProfileRepository,
} from '@/application/ports/user-profile-repository';
import { toUserProfileDto, type UserProfileDto } from '@/application/dto/user-profile';
import {
  createUserProfile,
  type UserProfileUpdate,
} from '@/domain/entities/user-profile';
import { createUserId, type UserId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type CompleteOnboardingError =
  | { readonly code: 'PROFILE_ALREADY_EXISTS'; readonly message: string }
  | {
      readonly code: 'INVALID_PROFILE';
      readonly message: string;
      readonly field?: string;
    };

export interface CompleteOnboardingInput extends UserProfileUpdate {
  readonly userId: string;
}

export class CompleteOnboardingUseCase {
  constructor(private readonly profileRepository: UserProfileRepository) {}

  async execute(
    input: CompleteOnboardingInput,
  ): Promise<Result<UserProfileDto, CompleteOnboardingError>> {
    // userId is session-derived; a blank id can only indicate a caller bug,
    // but the port needs a branded id, so validate before touching it.
    const userId = asBrandedUserId(input.userId);
    if (userId === null) {
      return err({
        code: 'INVALID_PROFILE',
        message: 'Invalid user identifier',
        field: 'userId',
      });
    }

    // Friendly preflight check. The user_id primary key is the final
    // authority for the race between this check and the insert below.
    const existing = await this.profileRepository.findByUserId(userId);
    if (existing !== null) {
      return err(profileAlreadyExists());
    }

    const now = new Date();
    const profileResult = createUserProfile({
      userId: input.userId,
      birthYear: input.birthYear,
      experienceLevel: input.experienceLevel,
      primaryGoal: input.primaryGoal,
      availableEquipment: input.availableEquipment,
      physicalConsiderations: input.physicalConsiderations,
      preferredDaysPerWeek: input.preferredDaysPerWeek,
      preferredSessionMinutes: input.preferredSessionMinutes,
      heightCm: input.heightCm,
      weightKg: input.weightKg,
      createdAt: now,
      updatedAt: now,
    });

    if (!profileResult.ok) {
      return err({
        code: 'INVALID_PROFILE',
        message: profileResult.error.message,
        field: profileResult.error.field,
      });
    }

    try {
      await this.profileRepository.create(profileResult.data);
    } catch (error) {
      if (error instanceof ProfileAlreadyExistsError) {
        return err(profileAlreadyExists());
      }
      throw error;
    }

    return ok(toUserProfileDto(profileResult.data));
  }
}

function asBrandedUserId(value: string): UserId | null {
  const result = createUserId(value);
  return result.ok ? result.data : null;
}

function profileAlreadyExists(): CompleteOnboardingError {
  return {
    code: 'PROFILE_ALREADY_EXISTS',
    message: 'You have already completed onboarding. Your profile is ready to use.',
  };
}
