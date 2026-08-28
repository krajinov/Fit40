/**
 * Current-user access for server-side code.
 *
 * The feature layer's only job here is reading the trusted session cookie;
 * all identity resolution is delegated to the application-layer
 * GetCurrentUserUseCase. `cache()` deduplicates resolution within a single
 * request.
 *
 * Future ownership/enrollment features must derive UserId from
 * `requireUser()` — never from client-supplied form fields.
 */

import { cache } from 'react';
import { redirect } from 'next/navigation';

import type { UserDto } from '@/application/dto/user';
import { getCurrentUserUseCase } from '@/features/auth/services';
import { getSessionToken } from '@/features/auth/session-cookie';

export const getCurrentUser = cache(async (): Promise<UserDto | null> => {
  const token = await getSessionToken();
  if (token === null) {
    return null;
  }

  return getCurrentUserUseCase.execute(token);
});

/**
 * Returns the authenticated user or redirects to the login page.
 * Use in protected Server Components.
 */
export async function requireUser(nextPath: string = '/dashboard'): Promise<UserDto> {
  const user = await getCurrentUser();
  if (user === null) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  return user;
}
