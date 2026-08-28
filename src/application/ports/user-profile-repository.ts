/**
 * UserProfile repository port.
 *
 * Defines the contract the Drizzle profile repository must satisfy. The
 * application layer depends only on this port.
 *
 * Create and update are separate operations (no upsert): onboarding creates
 * the single allowed profile for a user, while editing updates the existing
 * one. The user_id primary key keeps at most one profile per user; a create
 * racing that constraint surfaces as ProfileAlreadyExistsError so use cases
 * can map it to the PROFILE_ALREADY_EXISTS business outcome without leaking
 * PostgreSQL details.
 *
 * The auth User entity is intentionally NOT part of this port: profile
 * persistence never touches users, auth sessions, or training history.
 */

import type { UserProfile } from '@/domain/entities/user-profile';
import type { UserId } from '@/domain/types/ids';

/**
 * Thrown by `create` when the insert races the profile primary key (one
 * profile per user). The caller should map this to the PROFILE_ALREADY_EXISTS
 * business outcome.
 */
export class ProfileAlreadyExistsError extends Error {
  constructor(readonly userId: string) {
    super(`A profile for user "${userId}" already exists`);
    this.name = 'ProfileAlreadyExistsError';
  }
}

export interface UserProfileRepository {
  /**
   * Finds the user's profile, or null when the user has not completed
   * onboarding yet. Absence is a normal state, not an error.
   */
  findByUserId(userId: UserId): Promise<UserProfile | null>;

  /**
   * Persists a new profile. The caller must have established that none exists
   * yet; the primary key remains the final authority for concurrent submits.
   *
   * May throw {@link ProfileAlreadyExistsError} on a concurrent create race.
   */
  create(profile: UserProfile): Promise<void>;

  /**
   * Replaces the editable fields of an existing profile (identified by the
   * profile's userId), including its updatedAt timestamp.
   *
   * Returns false when no profile row exists for the user, so callers can
   * treat a vanished profile (e.g. a concurrent account deletion) as the
   * expected PROFILE_NOT_FOUND outcome instead of an infrastructure failure.
   */
  update(profile: UserProfile): Promise<boolean>;
}
