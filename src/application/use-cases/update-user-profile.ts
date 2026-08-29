/**
 * Use case: update the authenticated user's existing fitness profile.
 *
 * Editing never creates a profile and never touches the auth identity, auth
 * sessions, or training history — it only replaces the editable fields of the
 * existing profile row, preserving identity and createdAt while bumping
 * updatedAt. An update racing a vanished profile (e.g. concurrent account
 * deletion) surfaces as the expected PROFILE_NOT_FOUND outcome.
 *
 * The userId must come from the trusted authenticated session at the
 * presentation layer, never from client form data.
 */

import type { UserProfileRepository } from '@/application/ports/user-profile-repository';
import { toUserProfileDto, type UserProfileDto } from '@/application/dto/user-profile';
import {
  applyProfileUpdate,
  type UserProfileUpdate,
} from '@/domain/entities/user-profile';
import { createUserId, type UserId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type UpdateUserProfileError =
  | { readonly code: 'PROFILE_NOT_FOUND'; readonly message: string }
  | {
      readonly code: 'INVALID_PROFILE';
      readonly message: string;
      readonly field?: string;
    };

export interface UpdateUserProfileInput extends UserProfileUpdate {
  readonly userId: string;
}

export class UpdateUserProfileUseCase {
  constructor(private readonly profileRepository: UserProfileRepository) {}

  async execute(
    input: UpdateUserProfileInput,
  ): Promise<Result<UserProfileDto, UpdateUserProfileError>> {
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

    const existing = await this.profileRepository.findByUserId(userId);
    if (existing === null) {
      return err(profileNotFound());
    }

    const updatedResult = applyProfileUpdate(
      existing,
      {
        birthYear: input.birthYear,
        experienceLevel: input.experienceLevel,
        primaryGoal: input.primaryGoal,
        availableEquipment: input.availableEquipment,
        physicalConsiderations: input.physicalConsiderations,
        preferredDaysPerWeek: input.preferredDaysPerWeek,
        preferredSessionMinutes: input.preferredSessionMinutes,
        heightCm: input.heightCm,
        weightKg: input.weightKg,
      },
      new Date(),
    );

    if (!updatedResult.ok) {
      return err({
        code: 'INVALID_PROFILE',
        message: updatedResult.error.message,
        field: updatedResult.error.field,
      });
    }

    const updated = await this.profileRepository.update(updatedResult.data);
    if (!updated) {
      return err(profileNotFound());
    }

    return ok(toUserProfileDto(updatedResult.data));
  }
}

function asBrandedUserId(value: string): UserId | null {
  const result = createUserId(value);
  return result.ok ? result.data : null;
}

function profileNotFound(): UpdateUserProfileError {
  return {
    code: 'PROFILE_NOT_FOUND',
    message: 'No profile found. Please complete onboarding first.',
  };
}
