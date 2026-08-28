/**
 * User repository port.
 *
 * Defines the contract the Drizzle user repository must satisfy. The
 * application layer depends only on this port.
 *
 * The password hash is a persistence-only credential: it is not part of the
 * domain `User` and is exposed exclusively through `findCredentialsByEmail`,
 * whose name makes the hazard explicit. It is consumed only by the login use
 * case and must never cross into DTOs or the presentation layer.
 */

import type { User } from '@/domain/entities/user';
import type { UserId } from '@/domain/types/ids';
import type { EmailAddress } from '@/domain/value-objects/email-address';

/**
 * Thrown by `create` when the insert races the database's unique-email
 * constraint. The caller should map this to the `EMAIL_ALREADY_EXISTS`
 * business outcome.
 */
export class EmailAlreadyExistsError extends Error {
  constructor(readonly email: string) {
    super(`A user with email "${email}" already exists`);
    this.name = 'EmailAlreadyExistsError';
  }
}

/**
 * Credential record returned for login verification only.
 */
export interface UserCredentials {
  readonly user: User;
  readonly passwordHash: string;
}

export interface UserRepository {
  /**
   * Finds a user by their unique ID, or null if not found.
   */
  findById(id: UserId): Promise<User | null>;

  /**
   * Finds a user by normalized email, or null if not found.
   */
  findByEmail(email: EmailAddress): Promise<User | null>;

  /**
   * Finds a user together with their password hash, for credential
   * verification during login. Returns null if not found.
   */
  findCredentialsByEmail(email: EmailAddress): Promise<UserCredentials | null>;

  /**
   * Persists a new user with the given password hash.
   *
   * May throw {@link EmailAlreadyExistsError} when a concurrent registration
   * races the unique-email constraint.
   */
  create(user: User, passwordHash: string): Promise<void>;
}
