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
 *
 * RECOVERY (M19 P1 fix): the retry control calls Next.js `retry()`, not
 * `reset()`. Verified against next@16.3.1: `retry()` runs `context.refresh()`
 * before `reset()`, so recovery fetches a FRESH Server Component response
 * instead of replaying the failed one.
 */
interface AuthErrorProps {
  readonly error: unknown;
  readonly reset: () => void;
  readonly retry: () => void;
}

export default function AuthError({ error, retry }: AuthErrorProps) {
  useEffect(() => {
    console.error('Unhandled error in Fit40 authentication route', error);
  }, [error]);

  return (
    // A `div`, not `a main landmark`: the `(auth)` layout already provides the single
    // `main` landmark for this subtree (M19 P2 — avoid a nested landmark).
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <ErrorState
        className="w-full max-w-md"
        title="Something went wrong."
        body="This is a temporary problem, not something you did. You can try again."
        action={
          <Button type="button" onClick={retry}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
