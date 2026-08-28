/**
 * User entity: the authentication identity of a Fit40 account.
 *
 * This is deliberately minimal — it represents *who can sign in*, not the
 * person's fitness profile. Age, weight, goals, injuries, equipment and other
 * profile data belong to the future Profile/Onboarding slices and must not be
 * added here.
 *
 * The password hash is NOT part of the domain entity. It is a persistence-only
 * credential, reachable only through the explicitly named
 * `UserRepository.findCredentialsByEmail` port method, so it can never leak
 * into DTOs or the presentation layer by accident.
 *
 * Invariants enforced at construction:
 * - id must be a valid branded UserId
 * - email must be a valid, normalized EmailAddress
 * - createdAt must be a valid Date
 */

import { err, ok, type Result } from '@/lib/result';

import type { UserId } from '@/domain/types/ids';
import { createUserId } from '@/domain/types/ids';
import type { EmailAddress } from '@/domain/value-objects/email-address';
import { createEmailAddress } from '@/domain/value-objects/email-address';

export interface User {
  readonly id: UserId;
  readonly email: EmailAddress;
  readonly createdAt: Date;
}

export interface CreateUserInput {
  readonly id: string;
  readonly email: string;
  readonly createdAt: Date;
}

export type CreateUserError = {
  readonly message: string;
  readonly field?: 'id' | 'email' | 'createdAt';
};

export function createUser(input: CreateUserInput): Result<User, CreateUserError> {
  const idResult = createUserId(input.id);
  if (!idResult.ok) {
    return err({ message: idResult.error.message, field: 'id' });
  }

  const emailResult = createEmailAddress(input.email);
  if (!emailResult.ok) {
    return err({ message: emailResult.error.message, field: 'email' });
  }

  if (Number.isNaN(input.createdAt.getTime())) {
    return err({ message: 'createdAt must be a valid Date', field: 'createdAt' });
  }

  return ok({
    id: idResult.data,
    email: emailResult.data,
    createdAt: input.createdAt,
  });
}
