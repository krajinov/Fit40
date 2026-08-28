import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AuthSession } from '@/application/ports/session-repository';
import { createUser } from '@/domain/entities/user';
import { createUserId } from '@/domain/types/ids';
import { DrizzleSessionRepository } from '@/infrastructure/database/repositories/drizzle-session-repository';
import { DrizzleUserRepository } from '@/infrastructure/database/repositories/drizzle-user-repository';

import { client, db, resetDatabase } from './setup';

const userRepository = new DrizzleUserRepository(db);
const sessionRepository = new DrizzleSessionRepository(db);

async function createSampleUser(email: string): Promise<string> {
  const userResult = createUser({
    id: crypto.randomUUID(),
    email,
    createdAt: new Date(),
  });
  if (!userResult.ok) throw new Error('unexpected createUser failure');
  await userRepository.create(userResult.data, 'hash');
  return userResult.data.id;
}

describe('DrizzleSessionRepository', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('round-trips a session', async () => {
    const userId = createUserId(await createSampleUser('user@example.com'));
    if (!userId.ok) throw new Error('unexpected user id failure');

    const session: AuthSession = {
      tokenHash: 'hash-token-1',
      userId: userId.data,
      expiresAt: new Date('2099-01-01T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };

    await sessionRepository.create(session);
    const found = await sessionRepository.findByTokenHash(session.tokenHash);

    expect(found?.tokenHash).toBe(session.tokenHash);
    expect(found?.userId).toBe(userId.data);
    expect(found?.expiresAt.toISOString()).toBe('2099-01-01T00:00:00.000Z');
  });

  it('deletes a session by token hash', async () => {
    const userId = createUserId(await createSampleUser('user@example.com'));
    if (!userId.ok) throw new Error('unexpected user id failure');

    const session: AuthSession = {
      tokenHash: 'hash-token-2',
      userId: userId.data,
      expiresAt: new Date('2099-01-01T00:00:00Z'),
      createdAt: new Date(),
    };

    await sessionRepository.create(session);
    await sessionRepository.deleteByTokenHash(session.tokenHash);

    const found = await sessionRepository.findByTokenHash(session.tokenHash);
    expect(found).toBeNull();
  });

  it('cascades sessions when a user is deleted', async () => {
    const userIdValue = await createSampleUser('user@example.com');
    const userId = createUserId(userIdValue);
    if (!userId.ok) throw new Error('unexpected user id failure');

    await sessionRepository.create({
      tokenHash: 'hash-token-3',
      userId: userId.data,
      expiresAt: new Date('2099-01-01T00:00:00Z'),
      createdAt: new Date(),
    });

    // Cascade deletion is a schema-level behavior; use raw SQL because
    // the application-layer UserRepository intentionally has no delete yet.
    await db.execute(sql`DELETE FROM users WHERE id = ${userIdValue}`);

    const found = await sessionRepository.findByTokenHash('hash-token-3');
    expect(found).toBeNull();
  });

  it('deleteExpired removes only expired sessions and returns the deleted count', async () => {
    const userId = createUserId(await createSampleUser('user@example.com'));
    if (!userId.ok) throw new Error('unexpected user id failure');

    await sessionRepository.create({
      tokenHash: 'expired-token',
      userId: userId.data,
      expiresAt: new Date('2020-01-01T00:00:00Z'),
      createdAt: new Date('2019-12-01T00:00:00Z'),
    });
    await sessionRepository.create({
      tokenHash: 'live-token',
      userId: userId.data,
      expiresAt: new Date('2099-01-01T00:00:00Z'),
      createdAt: new Date(),
    });

    const deleted = await sessionRepository.deleteExpired(new Date());

    expect(deleted).toBe(1);
    expect(await sessionRepository.findByTokenHash('expired-token')).toBeNull();
    expect(await sessionRepository.findByTokenHash('live-token')).not.toBeNull();
  });

  it('deleteExpired returns 0 when nothing is expired', async () => {
    const deleted = await sessionRepository.deleteExpired(new Date());
    expect(deleted).toBe(0);
  });

  it('indexes auth_sessions.expires_at for the cleanup purge', async () => {
    const rows = await client<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'auth_sessions'
    `;

    const indexNames = rows.map((row) => row.indexname);
    expect(indexNames).toContain('auth_sessions_expires_at_idx');
    expect(indexNames).toContain('auth_sessions_user_id_idx');
  });
});
