import { eq } from 'drizzle-orm';

import type { AuthSession, SessionRepository } from '@/application/ports/session-repository';

import type { Database } from '../client';
import { mapRowToAuthSession } from '../mappers/user-mapper';
import { authSessions } from '../schema';

/**
 * Drizzle implementation of the SessionRepository port.
 */
export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly db: Database) {}

  async create(session: AuthSession): Promise<void> {
    await this.db.insert(authSessions).values({
      tokenHash: session.tokenHash,
      userId: session.userId,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
    });
  }

  async findByTokenHash(tokenHash: string): Promise<AuthSession | null> {
    const rows = await this.db
      .select()
      .from(authSessions)
      .where(eq(authSessions.tokenHash, tokenHash))
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : mapRowToAuthSession(row);
  }

  async deleteByTokenHash(tokenHash: string): Promise<void> {
    await this.db.delete(authSessions).where(eq(authSessions.tokenHash, tokenHash));
  }
}
