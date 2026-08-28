import { createUser, type User } from '@/domain/entities/user';
import type { AuthSession } from '@/application/ports/session-repository';
import { createUserId } from '@/domain/types/ids';

import type { authSessions, users } from '../schema/users';

type UserRow = typeof users.$inferSelect;
type AuthSessionRow = typeof authSessions.$inferSelect;

/**
 * Maps a users row to the domain User. Throws on corrupt persisted state —
 * the database is trusted structurally but a row that violates domain
 * invariants indicates corruption and must fail loudly.
 *
 * The password hash is deliberately not mapped; it only leaves the repository
 * through the explicitly credential-shaped `findCredentialsByEmail` result.
 */
export function mapRowToUser(row: UserRow): User {
  const result = createUser({
    id: row.id,
    email: row.email,
    createdAt: row.createdAt,
  });

  if (!result.ok) {
    throw new Error(`Corrupt data in users row "${row.id}": ${result.error.message}`);
  }

  return result.data;
}

export function mapUserToRow(user: User, passwordHash: string): typeof users.$inferInsert {
  return {
    id: user.id,
    email: user.email,
    passwordHash,
    createdAt: user.createdAt,
  };
}

export function mapRowToAuthSession(row: AuthSessionRow): AuthSession {
  const userIdResult = createUserId(row.userId);
  if (!userIdResult.ok) {
    throw new Error(`Corrupt data in auth_sessions row "${row.tokenHash}": ${userIdResult.error.message}`);
  }

  if (Number.isNaN(row.expiresAt.getTime()) || Number.isNaN(row.createdAt.getTime())) {
    throw new Error(`Corrupt data in auth_sessions row "${row.tokenHash}": invalid timestamps`);
  }

  return {
    tokenHash: row.tokenHash,
    userId: userIdResult.data,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}
