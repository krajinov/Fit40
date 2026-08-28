'use server';

import { redirect } from 'next/navigation';

import { loginSchema, nextPathSchema } from '@/features/auth/schemas/auth-schemas';
import { loginUserUseCase } from '@/features/auth/services';
import { setSessionCookie } from '@/features/auth/session-cookie';
import type { AuthActionState } from '@/features/auth/types/auth-action-state';

/**
 * Authenticates a user, establishes a session, and redirects.
 *
 * On success this never returns: `redirect` throws NEXT_REDIRECT, which must
 * propagate (it is not an error and must not be caught). Expected failures
 * are returned as typed action state; INVALID_CREDENTIALS is deliberately
 * generic so the response reveals nothing about account existence.
 */
export async function loginAction(formData: FormData): Promise<AuthActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      email: submittedEmail(formData),
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please fix the errors below.',
        fieldErrors: flattenFieldErrors(parsed.error),
      },
    };
  }

  const result = await loginUserUseCase.execute({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (!result.ok) {
    return {
      ok: false,
      email: submittedEmail(formData),
      error: { code: result.error.code, message: result.error.message },
    };
  }

  await setSessionCookie(result.data.session.token, result.data.session.expiresAt);
  redirect(resolveNextPath(formData.get('next')));
}

/**
 * Echoes the submitted email back to the client so the form can preserve it
 * across expected errors (including INVALID_CREDENTIALS). Passwords are
 * intentionally never echoed — action state must not carry credentials back
 * to the client.
 */
function submittedEmail(formData: FormData): string | undefined {
  const value = formData.get('email');
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function flattenFieldErrors(error: {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
}): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
  }
  return fieldErrors;
}

function resolveNextPath(raw: FormDataEntryValue | null): string {
  const parsed = nextPathSchema.safeParse(raw);
  return parsed.success ? parsed.data : '/dashboard';
}
