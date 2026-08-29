/**
 * Use case: end an authenticated session.
 *
 * Idempotent: deleting a session that no longer exists succeeds. The caller
 * (a Server Action) additionally clears the session cookie.
 */

import type { SessionRepository } from '@/application/ports/session-repository';
import type { SessionTokenService } from '@/application/ports/session-token-service';
import { ok, type Result } from '@/domain/types/result';

export interface LogoutUserInput {
  /** Raw bearer token from the session cookie. */
  readonly token: string;
}

export class LogoutUserUseCase {
  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly tokenService: SessionTokenService,
  ) {}

  async execute(input: LogoutUserInput): Promise<Result<null, never>> {
    if (input.token.length > 0) {
      await this.sessionRepository.deleteByTokenHash(this.tokenService.hash(input.token));
    }

    return ok(null);
  }
}
