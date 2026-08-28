import { EmailAlreadyExistsError } from '@/application/ports/user-repository';
import type { AuthSession } from '@/application/ports/session-repository';
import type { RegistrationRepository } from '@/application/ports/registration-repository';
import type { User } from '@/domain/entities/user';

import type { Database } from '../client';
import { mapAuthSessionToRow, mapUserToRow } from '../mappers/user-mapper';
import { isUniqueViolation, pgConstraintName } from '../pg-error';
import { authSessions, users } from '../schema';

/**
 * Drizzle implementation of the RegistrationRepository port.
 *
 * Both inserts run inside a single database transaction, so a failed session
 * insert (e.g. a session primary-key/hash collision) rolls back the user
 * insert. A duplicate-email race surfaces as EmailAlreadyExistsError only when
 * the specific users.email unique constraint is the violation — other
 * constraint failures (such as a session token-hash collision) are rethrown as
 * unexpected errors but still roll back the whole unit.
 */
export class DrizzleRegistrationRepository implements RegistrationRepository {
  constructor(private readonly db: Database) {}

  async createUserWithSession(
    user: User,
    passwordHash: string,
    session: AuthSession,
  ): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(users).values(mapUserToRow(user, passwordHash));
        await tx.insert(authSessions).values(mapAuthSessionToRow(session));
      });
    } catch (error) {
      if (isUniqueViolation(error) && pgConstraintName(error) === 'users_email_unique') {
        throw new EmailAlreadyExistsError(user.email);
      }
      throw error;
    }
  }
}