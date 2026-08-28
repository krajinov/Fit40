/**
 * Use case: end an authenticated session.
 *
 * Idempotent: deleting a session that no longer exists succeeds. The caller
 * (a Server Action) additionally clears the session cookie.
 */

import type { SessionRepository } from '@/application/ports/session-repository';
import { hashSessionToken } from '@/application/use-cases/issue-session';
import { ok, type Result } from '@/lib/result';

export interface LogoutUserInput {
  /** Raw bearer token from the session cookie. */
  readonly token: string;
}

export class LogoutUserUseCase {
  constructor(private readonly sessionRepository: SessionRepository) {}

  async execute(input: LogoutUserInput): Promise<Result<null, never>> {
    if (input.token.length > 0) {
      await this.sessionRepository.deleteByTokenHash(hashSessionToken(input.token));
    }

    return ok(null);
  }
}
