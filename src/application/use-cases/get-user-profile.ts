/**
 * Use case: load the authenticated user's fitness profile.
 *
 * Returns null when the user has not completed onboarding yet — absence is a
 * normal, routing-relevant state rather than an error, mirroring how
 * GetCurrentUserUseCase treats unknown sessions. The userId must come from the
 * trusted authenticated session at the presentation layer, never from client
 * form data.
 */

import type { UserProfileRepository } from '@/application/ports/user-profile-repository';
import { toUserProfileDto, type UserProfileDto } from '@/application/dto/user-profile';
import { createUserId } from '@/domain/types/ids';

export class GetUserProfileUseCase {
  constructor(private readonly profileRepository: UserProfileRepository) {}

  async execute(userId: string): Promise<UserProfileDto | null> {
    const idResult = createUserId(userId);
    if (!idResult.ok) {
      return null;
    }

    const profile = await this.profileRepository.findByUserId(idResult.data);
    return profile === null ? null : toUserProfileDto(profile);
  }
}
