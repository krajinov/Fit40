import { eq } from 'drizzle-orm';

import {
  ProfileAlreadyExistsError,
  type UserProfileRepository,
} from '@/application/ports/user-profile-repository';
import type { UserProfile } from '@/domain/entities/user-profile';
import type { UserId } from '@/domain/types/ids';

import type { Database } from '../client';
import { mapRowToUserProfile, mapUserProfileToRow } from '../mappers/user-profile-mapper';
import { isUniqueViolation } from '../pg-error';
import { profiles } from '../schema';

/**
 * Drizzle implementation of the UserProfileRepository port.
 *
 * The user_id primary key keeps at most one profile per user: a create racing
 * that constraint surfaces as ProfileAlreadyExistsError so use cases can map
 * it to the PROFILE_ALREADY_EXISTS business outcome without seeing database
 * details. Update returns whether a row was matched, so a profile that
 * vanished between precheck and write is handled as expected data.
 */
export class DrizzleUserProfileRepository implements UserProfileRepository {
  constructor(private readonly db: Database) {}

  async findByUserId(userId: UserId): Promise<UserProfile | null> {
    const rows = await this.db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : mapRowToUserProfile(row);
  }

  async create(profile: UserProfile): Promise<void> {
    try {
      await this.db.insert(profiles).values(mapUserProfileToRow(profile));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ProfileAlreadyExistsError(profile.userId);
      }
      throw error;
    }
  }

  async update(profile: UserProfile): Promise<boolean> {
    const matched = await this.db
      .update(profiles)
      .set(mapUserProfileToRow(profile))
      .where(eq(profiles.userId, profile.userId))
      .returning({ userId: profiles.userId });

    return matched.length > 0;
  }
}
