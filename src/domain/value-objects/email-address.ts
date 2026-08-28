/**
 * EmailAddress value object.
 *
 * An EmailAddress is the canonical form of a user's email: trimmed and
 * lowercased. Normalization is a domain responsibility — every EmailAddress
 * is guaranteed canonical once constructed, so `User@Example.com` and
 * `user@example.com` can never become two different identities.
 *
 * The database enforces the same rule as final authority
 * (`CHECK (email = lower(email))` + UNIQUE), but domain construction is the
 * primary gate.
 */

import { err, ok, type Result } from '@/lib/result';

export type EmailAddress = string & { readonly __brand: 'EmailAddress' };

// Pragmatic RFC-5322 subset: local@domain with a dot in the domain.
// Boundary validation (Zod) is stricter about UX messaging; this check is the
// domain invariant.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const EMAIL_MAX_LENGTH = 254;

/**
 * Returns the canonical form of a raw email string: trimmed and lowercased.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Creates a validated, normalized EmailAddress.
 *
 * The cast is safe because the value has just been validated; the brand is a
 * compile-time-only marker and the runtime value remains a plain string.
 */
export function createEmailAddress(
  raw: string,
): Result<EmailAddress, { readonly message: string }> {
  const normalized = normalizeEmail(raw);

  if (normalized.length === 0) {
    return err({ message: 'Email address cannot be empty' });
  }

  if (normalized.length > EMAIL_MAX_LENGTH) {
    return err({ message: `Email address cannot exceed ${EMAIL_MAX_LENGTH} characters` });
  }

  if (!EMAIL_PATTERN.test(normalized)) {
    return err({ message: 'Email address is not valid' });
  }

  return ok(normalized as EmailAddress);
}
