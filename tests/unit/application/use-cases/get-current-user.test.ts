import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionRepository } from '@/application/ports/session-repository';
import type { UserRepository } from '@/application/ports/user-repository';
import { GetCurrentUserUseCase } from '@/application/use-cases/get-current-user';
import type { User } from '@/domain/entities/user';
import type { UserId } from '@/domain/types/ids';
import { FakeSessionTokenService } from '../../helpers/fake-crypto';

describe('GetCurrentUserUseCase', () => {
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

  const tokenService = new FakeSessionTokenService();
  const useCase = new GetCurrentUserUseCase(userRepository, sessionRepository, tokenService);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns the user for a valid, unexpired session', async () => {
    const user = { id: 'u-1', email: 'user@example.com', createdAt: new Date() } as User;
    vi.mocked(sessionRepository.findByTokenHash).mockResolvedValue({
      tokenHash: tokenService.hash('token'),
      userId: 'u-1' as UserId,
      expiresAt: new Date('2099-01-01T00:00:00Z'),
      createdAt: new Date(),
    });
    vi.mocked(userRepository.findById).mockResolvedValue(user);

    const result = await useCase.execute('token');

    expect(result).not.toBeNull();
    expect(result?.email).toBe('user@example.com');
    expect(result?.id).toBe('u-1');
    expect(sessionRepository.findByTokenHash).toHaveBeenCalledWith('fake-hash:token');
  });

  it('returns null for a missing token', async () => {
    const result = await useCase.execute('');

    expect(result).toBeNull();
    expect(sessionRepository.findByTokenHash).not.toHaveBeenCalled();
  });

  it('returns null for an expired session and deletes the row on encounter', async () => {
    const expiredTokenHash = tokenService.hash('token');
    vi.mocked(sessionRepository.findByTokenHash).mockResolvedValue({
      tokenHash: expiredTokenHash,
      userId: 'u-1' as UserId,
      expiresAt: new Date('2000-01-01T00:00:00Z'),
      createdAt: new Date(),
    });

    const result = await useCase.execute('token');

    expect(result).toBeNull();
    expect(userRepository.findById).not.toHaveBeenCalled();
    expect(sessionRepository.deleteByTokenHash).toHaveBeenCalledWith(expiredTokenHash);
  });

  it('returns null if the session user no longer exists', async () => {
    vi.mocked(sessionRepository.findByTokenHash).mockResolvedValue({
      tokenHash: tokenService.hash('token'),
      userId: 'u-1' as UserId,
      expiresAt: new Date('2099-01-01T00:00:00Z'),
      createdAt: new Date(),
    });
    vi.mocked(userRepository.findById).mockResolvedValue(null);

    const result = await useCase.execute('token');

    expect(result).toBeNull();
  });
});
