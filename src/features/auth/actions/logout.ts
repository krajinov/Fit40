'use server';

import { redirect } from 'next/navigation';

import { logoutUserUseCase } from '@/features/auth/services';
import { clearSessionCookie, getSessionToken } from '@/features/auth/session-cookie';

/**
 * Ends the current session and redirects to the public landing page.
 *
 * Logout is idempotent and always succeeds from the user's perspective: the
 * session row is deleted if it exists and the cookie is ALWAYS cleared — even
 * when server-side revocation fails — so a transient database failure can
 * never leave the browser locally authenticated.
 *
 * Revocation failures are not swallowed: after the cookie is cleared in the
 * `finally` block, the unexpected error propagates to the error boundary and
 * the redirect to `/` is intentionally skipped. `redirect()` itself sits
 * outside the `try`, so NEXT_REDIRECT is never caught or converted.
 */
export async function logoutAction(): Promise<void> {
  const token = await getSessionToken();
  try {
    if (token !== null) {
      await logoutUserUseCase.execute({ token });
    }
  } finally {
    await clearSessionCookie();
  }

  redirect('/');
}
