import type { AuthSession } from '@/application/ports/session-repository';
import type { User } from '@/domain/entities/user';

/**
 * Registration persistence port.
 *
 * Registering a new account must persist the user and their initial
 * authenticated session as one atomic unit: if the session write fails, the
 * user write must be rolled back so an orphaned account is never left behind.
 *
 * The transaction boundary lives in the infrastructure implementation of this
 * port, not in domain or application logic. The application use case only
 * depends on this port and never sees Drizzle or PostgreSQL.
 */
export interface RegistrationRepository {
  /**
   * Atomically persists a new user and a session for that user.
   *
   * May throw {@link EmailAlreadyExistsError} when a concurrent registration
   * races the unique-email constraint. Any other failure rolls back the user
   * insert.
   */
  createUserWithSession(user: User, passwordHash: string, session: AuthSession): Promise<void>;
}