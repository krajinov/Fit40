'use client';

import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/shared/ErrorState';

/**
 * M19 S1 — error boundary for the `(app)` route group (all mixed public/private
 * application pages: dashboard, programs, exercises, history, progress, ...).
 *
 * SCOPE (verified against next@16.3.1 — see docs/milestones/milestone-19-plan.md
 * §6.2): this boundary catches rendering failures in the group's CHILD pages.
 * It does NOT catch failures in the group's own `layout.tsx`; those propagate to
 * the root `global-error.tsx`. A boundary never covers its own layout.
 *
 * CONTRACTS PRESERVED:
 * - Authentication redirects (`redirect()` inside requireUser) are Next.js
 *   navigation, not rendering failures — they are never rendered here.
 * - `notFound()` renders the 404 route, not this boundary.
 * - Expected domain/application errors are returned as typed `Result`/view
 *   states and render their own truthful "unavailable"/empty copy; they never
 *   reach this boundary. This is the recoverable layer ONLY for unexpected
 *   throws.
 *
 * PRIVACY: the raw `error` is logged to the server/console and is NEVER passed
 * to `ErrorState` (which renders only fixed, user-facing copy), so internal
 * messages, stack traces, SQL and digests cannot reach the user.
 *
 * RECOVERY (M19 P1 fix): the retry control calls Next.js `retry()`, not
 * `reset()`. Verified against next@16.3.1 (`ErrorInfo = { error, reset, retry }`;
 * `retry()` runs `context.refresh()` before `reset()`), so a transient
 * database/server failure is recovered by fetching a FRESH Server Component
 * response. `reset()` alone only clears the boundary and can replay the same
 * failed response. This is the reason `retry` is used here.
 */
interface AppErrorProps {
  readonly error: unknown;
  readonly reset: () => void;
  readonly retry: () => void;
}

export default function AppError({ error, retry }: AppErrorProps) {
  useEffect(() => {
    console.error('Unhandled error in Fit40 application route', error);
  }, [error]);

  return (
    // A `div`, not `a main landmark`: the `(app)` layout already provides the single
    // `main` landmark for this subtree (M19 P2 — avoid a nested landmark).
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <ErrorState
        className="w-full max-w-md"
        title="Something went wrong while loading this page."
        body="This is a temporary problem, not something you did. You can try again — if it keeps happening, reloading the page may help."
        action={
          <Button type="button" onClick={retry}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
