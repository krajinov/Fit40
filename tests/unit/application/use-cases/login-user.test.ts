import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PasswordHasher } from '@/application/ports/password-hasher';
import type { SessionRepository } from '@/application/ports/session-repository';
import type { UserRepository } from '@/application/ports/user-repository';
import { LoginUserUseCase } from '@/application/use-cases/login-user';
import type { User } from '@/domain/entities/user';
import { FakeSessionTokenService } from '../../helpers/fake-crypto';

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
    deleteExpired: vi.fn(),
  };

  const passwordHasher: PasswordHasher = {
    hash: vi.fn(),
    verify: vi.fn(),
  };

  let tokenService: FakeSessionTokenService;
  let useCase: LoginUserUseCase;

  beforeEach(() => {
    vi.resetAllMocks();
    tokenService = new FakeSessionTokenService();
    useCase = new LoginUserUseCase(userRepository, sessionRepository, passwordHasher, tokenService);
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
    expect(result.data.session.token).toBe('fake-token-1');

    expect(sessionRepository.create).toHaveBeenCalledTimes(1);
    const persisted = vi.mocked(sessionRepository.create).mock.calls[0]?.[0];
    expect(persisted?.tokenHash).toBe('fake-hash:fake-token-1');
    expect(persisted?.userId).toBe('u-1');
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

  it('propagates unexpected verifier failures instead of mapping them to INVALID_CREDENTIALS', async () => {
    const user = {
      id: 'u-1',
      email: 'user@example.com',
      createdAt: now,
    } as User;
    vi.mocked(userRepository.findCredentialsByEmail).mockResolvedValue({
      user,
      passwordHash: 'hash',
    });
    const failure = new Error('argon2 runtime failure');
    vi.mocked(passwordHasher.verify).mockRejectedValue(failure);

    await expect(
      useCase.execute({ email: 'user@example.com', password: 'password123' }),
    ).rejects.toBe(failure);
    expect(sessionRepository.create).not.toHaveBeenCalled();
  });

  it('purges expired sessions opportunistically on a successful login', async () => {
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
    vi.mocked(sessionRepository.deleteExpired).mockResolvedValue(0);

    const result = await useCase.execute({
      email: 'user@example.com',
      password: 'password123',
    });

    expect(result.ok).toBe(true);
    expect(sessionRepository.deleteExpired).toHaveBeenCalledTimes(1);
    expect(sessionRepository.deleteExpired).toHaveBeenCalledWith(expect.any(Date));
  });

  it('purges expired sessions even when credentials fail', async () => {
    vi.mocked(userRepository.findCredentialsByEmail).mockResolvedValue(null);
    vi.mocked(passwordHasher.verify).mockResolvedValue(false);
    vi.mocked(sessionRepository.deleteExpired).mockResolvedValue(0);

    const result = await useCase.execute({
      email: 'missing@example.com',
      password: 'password123',
    });

    expect(result.ok).toBe(false);
    expect(sessionRepository.deleteExpired).toHaveBeenCalledTimes(1);
  });

  it('does not swallow unexpected cleanup failures', async () => {
    vi.mocked(sessionRepository.deleteExpired).mockRejectedValue(new Error('db unreachable'));

    await expect(
      useCase.execute({ email: 'user@example.com', password: 'password123' }),
    ).rejects.toThrow('db unreachable');

    expect(userRepository.findCredentialsByEmail).not.toHaveBeenCalled();
  });
});
