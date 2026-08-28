/**
 * Use case: register a new user account.
 *
 * Normalizes the email, checks for a friendly duplicate, hashes the password,
 * creates the user, and issues an authenticated session. The unique-email
 * constraint remains the final authority: a concurrent registration race is
 * caught from the repository and mapped to the same EMAIL_ALREADY_EXISTS
 * outcome without leaking PostgreSQL details.
 */

import crypto from 'crypto';

import type { PasswordHasher } from '@/application/ports/password-hasher';
import type { SessionRepository } from '@/application/ports/session-repository';
import {
  EmailAlreadyExistsError,
  type UserRepository,
} from '@/application/ports/user-repository';
import { toUserDto, type UserDto } from '@/application/dto/user';
import {
  issueSession,
  type IssuedSession,
} from '@/application/use-cases/issue-session';
import { createUser } from '@/domain/entities/user';
import { normalizeEmail } from '@/domain/value-objects/email-address';
import { err, ok, type Result } from '@/lib/result';

export type RegisterUserError =
  | { readonly code: 'EMAIL_ALREADY_EXISTS'; readonly email: string; readonly message: string }
  | { readonly code: 'INVALID_USER'; readonly message: string };

export interface RegisterUserInput {
  readonly email: string;
  readonly password: string;
}

export interface RegisterUserResult {
  readonly user: UserDto;
  readonly session: IssuedSession;
}

export class RegisterUserUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async execute(input: RegisterUserInput): Promise<Result<RegisterUserResult, RegisterUserError>> {
    const email = normalizeEmail(input.email);

    const userResult = createUser({
      id: crypto.randomUUID(),
      email,
      createdAt: new Date(),
    });

    if (!userResult.ok) {
      return err({ code: 'INVALID_USER', message: userResult.error.message });
    }

    const user = userResult.data;

    // Friendly preflight check. The unique constraint is the final authority
    // for the race between this check and the insert below.
    const existing = await this.userRepository.findByEmail(user.email);
    if (existing !== null) {
      return err(emailAlreadyExists(user.email));
    }

    const passwordHash = await this.passwordHasher.hash(input.password);

    try {
      await this.userRepository.create(user, passwordHash);
    } catch (error) {
      if (error instanceof EmailAlreadyExistsError) {
        return err(emailAlreadyExists(user.email));
      }
      throw error;
    }

    const session = await issueSession(this.sessionRepository, user.id);

    return ok({ user: toUserDto(user), session });
  }
}

function emailAlreadyExists(email: string): RegisterUserError {
  return {
    code: 'EMAIL_ALREADY_EXISTS',
    email,
    message: 'An account with this email already exists.',
  };
}
