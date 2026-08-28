import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PasswordHasher } from '@/application/ports/password-hasher';
import type { SessionRepository } from '@/application/ports/session-repository';
import type { UserRepository } from '@/application/ports/user-repository';
import { LoginUserUseCase } from '@/application/use-cases/login-user';
import type { User } from '@/domain/entities/user';

describe('LoginUserUseCase', () => {
  const now = new Date('2026-01-01T00:00:00Z');

  const userRepository: UserRepository = {
    findById: vi.fn(),
    findByEmail: vi.fn(),
    findCredentialsByEmail: vi.fn(),
    create: vi.fn(),
  };

  const sessionRepository: SessionRepository = {
    create: vi.fn(),
    findByTokenHash: vi.fn(),
    deleteByTokenHash: vi.fn(),
  };

  const passwordHasher: PasswordHasher = {
    hash: vi.fn(),
    verify: vi.fn(),
  };

  const useCase = new LoginUserUseCase(
    userRepository,
    sessionRepository,
    passwordHasher,
  );

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('logs in with valid credentials', async () => {
    const user = {
      id: 'u-1',
      email: 'user@example.com',
      createdAt: now,
    } as User;
    vi.mocked(userRepository.findCredentialsByEmail).mockResolvedValue({
      user,
      passwordHash: 'hash',
    });
    vi.mocked(passwordHasher.verify).mockResolvedValue(true);

    const result = await useCase.execute({
      email: 'user@example.com',
      password: 'password123',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unexpected failure');

    expect(result.data.user.email).toBe('user@example.com');
    expect(sessionRepository.create).toHaveBeenCalledTimes(1);
  });

  it('returns INVALID_CREDENTIALS for an unknown email', async () => {
    vi.mocked(userRepository.findCredentialsByEmail).mockResolvedValue(null);
    vi.mocked(passwordHasher.verify).mockResolvedValue(false);

    const result = await useCase.execute({
      email: 'missing@example.com',
      password: 'password123',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unexpected success');

    expect(result.error.code).toBe('INVALID_CREDENTIALS');
    expect(passwordHasher.verify).toHaveBeenCalledTimes(1);
  });

  it('returns INVALID_CREDENTIALS for a wrong password', async () => {
    const user = {
      id: 'u-1',
      email: 'user@example.com',
      createdAt: now,
    } as User;
    vi.mocked(userRepository.findCredentialsByEmail).mockResolvedValue({
      user,
      passwordHash: 'hash',
    });
    vi.mocked(passwordHasher.verify).mockResolvedValue(false);

    const result = await useCase.execute({
      email: 'user@example.com',
      password: 'wrong-password',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unexpected success');

    expect(result.error.code).toBe('INVALID_CREDENTIALS');
    expect(passwordHasher.verify).toHaveBeenCalledWith('hash', 'wrong-password');
  });
});
