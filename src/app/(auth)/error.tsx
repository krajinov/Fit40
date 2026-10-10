'use client';

import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/shared/ErrorState';

/**
 * M19 S1 — error boundary for the `(auth)` route group (login, register).
 *
 * SCOPE (verified against next@16.3.1 — see docs/milestones/milestone-19-plan.md
 * §6.2): catches rendering failures in the auth pages. A failure inside the
 * `(auth)` layout itself propagates to the root `global-error.tsx`; a boundary
 * does not cover its own layout.
 *
 * The login/register pages resolve the current user to redirect signed-in
 * visitors; that redirect is navigation and never renders here. Server Action
 * validation errors are typed action state, not rendering failures.
 *
 * PRIVACY: the raw `error` is logged and never rendered — `ErrorState` shows
 * only fixed copy.
 */
interface AuthErrorProps {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}

export default function AuthError({ error, reset }: AuthErrorProps) {
  useEffect(() => {
    console.error('Unhandled error in Fit40 authentication route', error);
  }, [error]);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <ErrorState
        className="w-full max-w-md"
        title="Something went wrong."
        body="This is a temporary problem, not something you did. You can try again."
        action={
          <Button type="button" onClick={reset}>
            Try again
          </Button>
        }
      />
    </main>
  );
}
