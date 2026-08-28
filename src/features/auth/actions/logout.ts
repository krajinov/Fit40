'use server';

import { redirect } from 'next/navigation';

import { logoutUserUseCase } from '@/features/auth/services';
import { clearSessionCookie, getSessionToken } from '@/features/auth/session-cookie';

/**
 * Ends the current session and redirects to the public landing page.
 *
 * Logout is idempotent and always succeeds from the user's perspective:
 * the session row is deleted if it exists and the cookie is cleared.
 */
export async function logoutAction(): Promise<void> {
  const token = await getSessionToken();
  if (token !== null) {
    await logoutUserUseCase.execute({ token });
  }

  await clearSessionCookie();
  redirect('/');
}
