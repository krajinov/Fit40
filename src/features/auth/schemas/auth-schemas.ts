import { z } from 'zod';

import { normalizeEmail } from '@/domain/value-objects/email-address';

/**
 * Boundary validation for auth forms.
 *
 * Email is normalized (trim + lowercase) via transform so the application
 * layer always receives canonical input. `confirmPassword` is a
 * presentation-only concern — it is validated here and never forwarded to
 * the use case.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const emailSchema = z
  .string()
  .transform(normalizeEmail)
  .pipe(z.email({ message: 'Enter a valid email address.' }));

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`);

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required.'),
});

/**
 * Open-redirect guard.
 *
 * A redirect target must be an internal application-relative path. We parse
 * the candidate against a fixed internal origin and require the normalized
 * URL to remain on that same origin. Because the WHATWG URL parser treats a
 * backslash as a path separator for http(s), inputs such as `/\evil.example`
 * normalize to an external origin and are rejected here — as are
 * protocol-relative (`//host`), absolute, and percent-encoded smuggling
 * variants.
 *
 * The base origin is a fixed placeholder used only for parsing normalization,
 * never for real navigation; the returned value is always a relative path.
 */
export const APP_ORIGIN = 'https://fit40.local';

/**
 * Returns the normalized safe internal path, or null when the target must not
 * be used. Internal paths and their query/hash fragments are preserved.
 */
export function resolveSafeNextPath(value: string): string | null {
  if (value.length === 0 || value.includes('\\')) {
    return null;
  }

  // Must be a single-slash-relative path.
  if (!value.startsWith('/') || value.startsWith('//')) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value, APP_ORIGIN);
  } catch {
    return null;
  }

  // After normalization the target must still be on our own origin. This
  // rejects `//evil.example` and backslash smuggling (`/\evil.example`)
  // that the parser treats as protocol-relative or absolute.
  if (parsed.origin !== APP_ORIGIN) {
    return null;
  }

  // Decode percent-encoding and re-verify the path is single-slash rooted and
  // smuggles neither a scheme-leading double slash nor a backslash.
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }

  if (
    !decodedPath.startsWith('/') ||
    decodedPath.startsWith('//') ||
    decodedPath.includes('\\')
  ) {
    return null;
  }

  return parsed.pathname + parsed.search + parsed.hash;
}

/**
 * Redirect target schema. `safeParse` succeeds only for targets that normalize
 * to a safe internal path; anything else falls back to the default target at
 * the call site.
 */
export const nextPathSchema = z
  .string()
  .transform(resolveSafeNextPath)
  .pipe(z.string().min(1, 'Redirect target must be a relative internal path.'));
