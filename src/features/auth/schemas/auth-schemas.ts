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
 * Open-redirect guard: only relative internal paths are valid redirect
 * targets. `//evil.com` and absolute URLs are rejected.
 */
export const nextPathSchema = z
  .string()
  .regex(/^\/(?!\/)/, 'Redirect target must be a relative internal path.');
