/**
 * Session repository port.
 *
 * An AuthSession is a database-backed login session. The persisted identifier
 * is the SHA-256 hash of the opaque bearer token handed to the client, so a
 * database leak never exposes usable session tokens.
 */

import type { UserId } from '@/domain/types/ids';

export interface AuthSession {
  /** SHA-256 hex digest of the bearer token. Primary key. */
  readonly tokenHash: string;
  readonly userId: UserId;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export interface SessionRepository {
  /**
   * Persists a new session.
   */
  create(session: AuthSession): Promise<void>;

  /**
   * Finds a session by hashed token, or null if not found.
   * Expiry is NOT checked here — the caller decides how to treat expiry.
   */
  findByTokenHash(tokenHash: string): Promise<AuthSession | null>;

  /**
   * Deletes a session by hashed token. Idempotent: deleting a session that
   * does not exist succeeds silently.
   */
  deleteByTokenHash(tokenHash: string): Promise<void>;
}
