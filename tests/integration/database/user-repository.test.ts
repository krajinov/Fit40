import { beforeEach, describe, expect, it } from 'vitest';

import { createUser } from '@/domain/entities/user';
import { EmailAlreadyExistsError } from '@/application/ports/user-repository';
import { DrizzleUserRepository } from '@/infrastructure/database/repositories/drizzle-user-repository';

import { db, resetDatabase } from './setup';

const repository = new DrizzleUserRepository(db);

describe('DrizzleUserRepository', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('creates and finds a user by id', async () => {
    const userResult = createUser({
      id: '11111111-1111-1111-1111-111111111111',
      email: 'user@example.com',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    expect(userResult.ok).toBe(true);
    if (!userResult.ok) throw new Error('unexpected createUser failure');

    await repository.create(userResult.data, 'hashed-password');

    const found = await repository.findById(userResult.data.id);

    expect(found).not.toBeNull();
    expect(found?.email).toBe('user@example.com');
    expect(found?.createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('finds a user by normalized email', async () => {
    const userResult = createUser({
      id: '11111111-1111-1111-1111-111111111111',
      email: 'User@Example.com',
      createdAt: new Date(),
    });

    expect(userResult.ok).toBe(true);
    if (!userResult.ok) throw new Error('unexpected createUser failure');

    await repository.create(userResult.data, 'hashed-password');

    const found = await repository.findByEmail(
      userResult.data.email, // already normalized
    );

    expect(found?.email).toBe('user@example.com');
  });

  it('findCredentialsByEmail returns the password hash, not plaintext', async () => {
    const userResult = createUser({
      id: '11111111-1111-1111-1111-111111111111',
      email: 'user@example.com',
      createdAt: new Date(),
    });

    expect(userResult.ok).toBe(true);
    if (!userResult.ok) throw new Error('unexpected createUser failure');

    const passwordHash = 'argon2id-hash-string';
    await repository.create(userResult.data, passwordHash);

    const credentials = await repository.findCredentialsByEmail(userResult.data.email);

    expect(credentials?.passwordHash).toBe(passwordHash);
    expect(credentials?.user.email).toBe('user@example.com');
  });

  it('rejects duplicate normalized emails', async () => {
    const firstResult = createUser({
      id: '11111111-1111-1111-1111-111111111111',
      email: 'user@example.com',
      createdAt: new Date(),
    });

    expect(firstResult.ok).toBe(true);
    if (!firstResult.ok) throw new Error('unexpected createUser failure');

    await repository.create(firstResult.data, 'hash-1');

    const duplicateResult = createUser({
      id: '22222222-2222-2222-2222-222222222222',
      email: 'User@Example.com',
      createdAt: new Date(),
    });

    expect(duplicateResult.ok).toBe(true);
    if (!duplicateResult.ok) throw new Error('unexpected createUser failure');

    await expect(repository.create(duplicateResult.data, 'hash-2')).rejects.toBeInstanceOf(
      EmailAlreadyExistsError,
    );
  });
});
