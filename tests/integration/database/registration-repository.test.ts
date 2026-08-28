import { beforeEach, describe, expect, it } from 'vitest';

import { EmailAlreadyExistsError } from '@/application/ports/user-repository';
import { buildSession } from '@/application/use-cases/issue-session';
import { createUser } from '@/domain/entities/user';
import { DrizzleRegistrationRepository } from '@/infrastructure/database/repositories/drizzle-registration-repository';
import { DrizzleSessionRepository } from '@/infrastructure/database/repositories/drizzle-session-repository';
import { DrizzleUserRepository } from '@/infrastructure/database/repositories/drizzle-user-repository';

import { db, resetDatabase } from './setup';

const registrationRepository = new DrizzleRegistrationRepository(db);
const userRepository = new DrizzleUserRepository(db);
const sessionRepository = new DrizzleSessionRepository(db);

function makeUser(id: string, email: string) {
  const result = createUser({ id, email, createdAt: new Date('2026-01-01T00:00:00Z') });
  if (!result.ok) throw new Error('unexpected createUser failure');
  return result.data;
}

describe('DrizzleRegistrationRepository', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('creates the user and their session atomically', async () => {
    const user = makeUser('11111111-1111-1111-1111-111111111111', 'user@example.com');
    const { session } = buildSession(user.id);

    await registrationRepository.createUserWithSession(user, 'hashed-password', session);

    const persistedUser = await userRepository.findByEmail(user.email);
    expect(persistedUser).not.toBeNull();
    expect(persistedUser?.id).toBe(user.id);

    const persistedSession = await sessionRepository.findByTokenHash(session.tokenHash);
    expect(persistedSession).not.toBeNull();
    expect(persistedSession?.userId).toBe(user.id);
  });

  it('rolls back the user when the session insert fails', async () => {
    // Seed a session occupying a given token hash.
    const first = makeUser('11111111-1111-1111-1111-111111111111', 'first@example.com');
    const firstSession = buildSession(first.id).session;
    await registrationRepository.createUserWithSession(first, 'hash-1', firstSession);

    // Second registration reuses the same token hash to force the session
    // insert inside the transaction to fail. The user insert must be rolled
    // back so no orphaned account is left behind.
    const second = makeUser('22222222-2222-2222-2222-222222222222', 'second@example.com');
    const secondSession = { ...buildSession(second.id).session, tokenHash: firstSession.tokenHash };

    await expect(
      registrationRepository.createUserWithSession(second, 'hash-2', secondSession),
    ).rejects.toThrow();

    expect(await userRepository.findById(second.id)).toBeNull();
    expect(await userRepository.findByEmail(second.email)).toBeNull();
  });

  it('maps a duplicate normalized email race to EmailAlreadyExistsError', async () => {
    const first = makeUser('11111111-1111-1111-1111-111111111111', 'user@example.com');
    await registrationRepository.createUserWithSession(
      first,
      'hash-1',
      buildSession(first.id).session,
    );

    const duplicate = makeUser('22222222-2222-2222-2222-222222222222', 'user@example.com');
    await expect(
      registrationRepository.createUserWithSession(duplicate, 'hash-2', buildSession(duplicate.id).session),
    ).rejects.toBeInstanceOf(EmailAlreadyExistsError);
  });
});