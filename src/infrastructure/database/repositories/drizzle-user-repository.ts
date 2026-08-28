import { eq } from 'drizzle-orm';

import {
  EmailAlreadyExistsError,
  type UserCredentials,
  type UserRepository,
} from '@/application/ports/user-repository';
import type { User } from '@/domain/entities/user';
import type { UserId } from '@/domain/types/ids';
import type { EmailAddress } from '@/domain/value-objects/email-address';

import type { Database } from '../client';
import { mapRowToUser, mapUserToRow } from '../mappers/user-mapper';
import { isUniqueViolation } from '../pg-error';
import { users } from '../schema';

/**
 * Drizzle implementation of the UserRepository port.
 *
 * Unique-constraint races on the email column surface as
 * EmailAlreadyExistsError so use cases can map them to the
 * EMAIL_ALREADY_EXISTS business outcome without seeing database details.
 */
export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: Database) {}

  async findById(id: UserId): Promise<User | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);

    const row = rows[0];
    return row === undefined ? null : mapRowToUser(row);
  }

  async findByEmail(email: EmailAddress): Promise<User | null> {
    const rows = await this.db.select().from(users).where(eq(users.email, email)).limit(1);

    const row = rows[0];
    return row === undefined ? null : mapRowToUser(row);
  }

  async findCredentialsByEmail(email: EmailAddress): Promise<UserCredentials | null> {
    const rows = await this.db.select().from(users).where(eq(users.email, email)).limit(1);

    const row = rows[0];
    if (row === undefined) {
      return null;
    }

    return { user: mapRowToUser(row), passwordHash: row.passwordHash };
  }

  async create(user: User, passwordHash: string): Promise<void> {
    try {
      await this.db.insert(users).values(mapUserToRow(user, passwordHash));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new EmailAlreadyExistsError(user.email);
      }
      throw error;
    }
  }
}
