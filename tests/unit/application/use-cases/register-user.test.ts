import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PasswordHasher } from '@/application/ports/password-hasher';
import type { SessionRepository } from '@/application/ports/session-repository';
import {
  EmailAlreadyExistsError,
  type UserRepository,
} from '@/application/ports/user-repository';
import type { User } from '@/domain/entities/user';
import { RegisterUserUseCase } from '@/application/use-cases/register-user';

describe('RegisterUserUseCase', () => {
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
    hash: vi.fn().mockResolvedValue('hashed-password'),
    verify: vi.fn(),
  };

  const useCase = new RegisterUserUseCase(
    userRepository,
    sessionRepository,
    passwordHasher,
  );

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('creates a user and issues a session for valid input', async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue(null);

    const result = await useCase.execute({
      email: 'User@Example.com',
      password: 'password123',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unexpected failure');

    expect(result.data.user.email).toBe('user@example.com');
    expect(result.data.session.token).toHaveLength(43); // base64url of 32 bytes
    expect(passwordHasher.hash).toHaveBeenCalledWith('password123');
    expect(userRepository.create).toHaveBeenCalledTimes(1);
    expect(sessionRepository.create).toHaveBeenCalledTimes(1);
  });

  it('returns EMAIL_ALREADY_EXISTS for a duplicate email', async () => {
    const existingUser = { id: 'u-1', email: 'user@example.com', createdAt: now } as User;
    vi.mocked(userRepository.findByEmail).mockResolvedValue(existingUser);

    const result = await useCase.execute({
      email: 'user@example.com',
      password: 'password123',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unexpected success');

    expect(result.error.code).toBe('EMAIL_ALREADY_EXISTS');
    expect(userRepository.create).not.toHaveBeenCalled();
  });

  it('maps concurrent unique-constraint race to EMAIL_ALREADY_EXISTS', async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue(null);
    vi.mocked(userRepository.create).mockRejectedValue(
      new EmailAlreadyExistsError('user@example.com'),
    );

    const result = await useCase.execute({
      email: 'user@example.com',
      password: 'password123',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unexpected success');

    expect(result.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });
});
