/**
 * Use case: resolve the currently authenticated user from a session token.
 *
 * The presentation layer reads the raw bearer token from the trusted session
 * cookie and delegates all identity resolution here — it never orchestrates
 * repositories itself. Returns null for unknown or expired sessions and for
 * sessions whose user no longer exists.
 */

import type { SessionRepository } from '@/application/ports/session-repository';
import type { UserRepository } from '@/application/ports/user-repository';
import { toUserDto, type UserDto } from '@/application/dto/user';
import { hashSessionToken } from '@/application/use-cases/issue-session';

export class GetCurrentUserUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly sessionRepository: SessionRepository,
  ) {}

  async execute(token: string): Promise<UserDto | null> {
    if (token.length === 0) {
      return null;
    }

    const session = await this.sessionRepository.findByTokenHash(hashSessionToken(token));
    if (session === null) {
      return null;
    }

    if (session.expiresAt <= new Date()) {
      // Hygiene, not authentication: an expired token can never authenticate
      // again, so remove the row now. Idempotent; no scheduler needed. Bulk
      // cleanup of never-represented expired rows happens at login.
      await this.sessionRepository.deleteByTokenHash(session.tokenHash);
      return null;
    }

    const user = await this.userRepository.findById(session.userId);
    return user === null ? null : toUserDto(user);
  }
}
