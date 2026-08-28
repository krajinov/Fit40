import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PasswordHasher } from '@/application/ports/password-hasher';
import type { RegistrationRepository } from '@/application/ports/registration-repository';
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

  const registrationRepository: RegistrationRepository = {
    createUserWithSession: vi.fn(),
  };

  const passwordHasher: PasswordHasher = {
    hash: vi.fn().mockResolvedValue('hashed-password'),
    verify: vi.fn(),
  };

  const useCase = new RegisterUserUseCase(
    userRepository,
    registrationRepository,
    passwordHasher,
  );

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('creates a user and issues a session for valid input', async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue(null);
    vi.mocked(registrationRepository.createUserWithSession).mockResolvedValue(undefined);

    const result = await useCase.execute({
      email: 'User@Example.com',
      password: 'password123',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unexpected failure');

    expect(result.data.user.email).toBe('user@example.com');
    expect(result.data.session.token).toHaveLength(43); // base64url of 32 bytes
    expect(passwordHasher.hash).toHaveBeenCalledWith('password123');
    expect(registrationRepository.createUserWithSession).toHaveBeenCalledTimes(1);
    const persistedSession = vi.mocked(registrationRepository.createUserWithSession).mock
      .calls[0]?.[2];
    expect(persistedSession?.userId).toBe(result.data.user.id);
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
    expect(registrationRepository.createUserWithSession).not.toHaveBeenCalled();
  });

  it('maps concurrent unique-constraint race to EMAIL_ALREADY_EXISTS', async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue(null);
    vi.mocked(registrationRepository.createUserWithSession).mockRejectedValue(
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

  it('rethrows unexpected persistence failures', async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue(null);
    const failure = new Error('database connection lost');
    vi.mocked(registrationRepository.createUserWithSession).mockRejectedValue(failure);

    await expect(
      useCase.execute({ email: 'user@example.com', password: 'password123' }),
    ).rejects.toBe(failure);
  });
});
