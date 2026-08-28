import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionRepository } from '@/application/ports/session-repository';
import { LogoutUserUseCase } from '@/application/use-cases/logout-user';
import { FakeSessionTokenService } from '../../helpers/fake-crypto';

describe('LogoutUserUseCase', () => {
  const sessionRepository: SessionRepository = {
    create: vi.fn(),
    findByTokenHash: vi.fn(),
    deleteByTokenHash: vi.fn(),
    deleteExpired: vi.fn(),
  };

  const tokenService = new FakeSessionTokenService();
  const useCase = new LogoutUserUseCase(sessionRepository, tokenService);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('deletes the session matching the token hash', async () => {
    const token = 'raw-token';

    const result = await useCase.execute({ token });

    expect(result.ok).toBe(true);
    expect(sessionRepository.deleteByTokenHash).toHaveBeenCalledWith('fake-hash:raw-token');
  });

  it('is idempotent when no session exists', async () => {
    vi.mocked(sessionRepository.deleteByTokenHash).mockResolvedValue(undefined);

    const result = await useCase.execute({ token: 'unknown-token' });

    expect(result.ok).toBe(true);
    expect(sessionRepository.deleteByTokenHash).toHaveBeenCalledWith('fake-hash:unknown-token');
  });
});
