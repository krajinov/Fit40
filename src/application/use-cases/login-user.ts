/**
 * Use case: authenticate a user by email and password.
 *
 * Failure is always the generic INVALID_CREDENTIALS outcome — the response
 * never reveals whether the email exists. For unknown emails a dummy argon2
 * verification runs against a constant hash so response timing does not
 * leak account existence either.
 *
 * Every login attempt also opportunistically purges expired sessions so
 * abandoned rows cannot accumulate indefinitely.
 */

import type { PasswordHasher } from '@/application/ports/password-hasher';
import type { SessionRepository } from '@/application/ports/session-repository';
import type { SessionTokenService } from '@/application/ports/session-token-service';
import type { UserRepository } from '@/application/ports/user-repository';
import { toUserDto, type UserDto } from '@/application/dto/user';
import {
  issueSession,
  type IssuedSession,
} from '@/application/use-cases/issue-session';
import { createEmailAddress } from '@/domain/value-objects/email-address';
import { err, ok, type Result } from '@/domain/types/result';

export type LoginUserError = {
  readonly code: 'INVALID_CREDENTIALS';
  readonly message: string;
};

export interface LoginUserInput {
  readonly email: string;
  readonly password: string;
}

export interface LoginUserResult {
  readonly user: UserDto;
  readonly session: IssuedSession;
}

// Pre-computed argon2id hash of a random throwaway password, used to equalize
// verification timing when the email does not exist.
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$W9zCjWy2/yAbZShA9eH4zQ$xQcfeBqlzQUPs3fxAMsTUMW3nMrk85yCXSZFMKDrDV0';

export class LoginUserUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly tokenService: SessionTokenService,
  ) {}

  async execute(input: LoginUserInput): Promise<Result<LoginUserResult, LoginUserError>> {
    // Opportunistic hygiene, not authentication: a global, index-backed purge
    // of expired sessions on every login attempt bounds table growth without
    // schedulers or background workers (login is the natural recurring auth
    // boundary). Expected to succeed whenever the DB is reachable at all.
    await this.sessionRepository.deleteExpired(new Date());

    const emailResult = createEmailAddress(input.email);
    if (!emailResult.ok) {
      await this.passwordHasher.verify(DUMMY_PASSWORD_HASH, input.password);
      return err(invalidCredentials());
    }

    const credentials = await this.userRepository.findCredentialsByEmail(emailResult.data);

    if (credentials === null) {
      // Timing equalization: burn one verification so "unknown email" is
      // indistinguishable from "wrong password".
      await this.passwordHasher.verify(DUMMY_PASSWORD_HASH, input.password);
      return err(invalidCredentials());
    }

    const passwordValid = await this.passwordHasher.verify(
      credentials.passwordHash,
      input.password,
    );

    if (!passwordValid) {
      return err(invalidCredentials());
    }

    const session = await issueSession(this.sessionRepository, this.tokenService, credentials.user.id);

    return ok({ user: toUserDto(credentials.user), session });
  }
}

function invalidCredentials(): LoginUserError {
  return {
    code: 'INVALID_CREDENTIALS',
    message: 'Invalid email or password.',
  };
}
