'use server';

import { redirect } from 'next/navigation';

import { registerSchema, nextPathSchema } from '@/features/auth/schemas/auth-schemas';
import { registerUserUseCase } from '@/features/auth/services';
import { setSessionCookie } from '@/features/auth/session-cookie';
import type { AuthActionState } from '@/features/auth/types/auth-action-state';

/**
 * Registers a new account, establishes a session, and redirects.
 *
 * On success this never returns: `redirect` throws NEXT_REDIRECT, which must
 * propagate (it is not an error and must not be caught). Expected failures
 * are returned as typed action state.
 */
export async function registerAction(formData: FormData): Promise<AuthActionState> {
  const parsed = registerSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please fix the errors below.',
        fieldErrors: flattenFieldErrors(parsed.error),
      },
    };
  }

  const result = await registerUserUseCase.execute({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: result.error.code,
        message: result.error.message,
        fieldErrors:
          result.error.code === 'EMAIL_ALREADY_EXISTS'
            ? { email: [result.error.message] }
            : undefined,
      },
    };
  }

  await setSessionCookie(result.data.session.token, result.data.session.expiresAt);
  redirect(resolveNextPath(formData.get('next')));
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
