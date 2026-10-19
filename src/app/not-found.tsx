import Link from 'next/link';

import { getSessionToken } from '@/features/auth/session-cookie';

/**
 * Context-aware 404.
 *
 * The page must stay a native 404: it never redirects, never calls
 * `requireUser()` and never renders an error boundary. It also performs no
 * database work — a 404 is a navigation dead end, so it must not depend on the
 * database being reachable. Only the session cookie's presence is read (an
 * HttpOnly cookie set by this application), which is enough to choose between
 * the two working destinations:
 *
 * - signed out: the public catalog plus the sign-in entry point;
 * - signed in: the public catalog plus the dashboard.
 *
 * A stale cookie is not re-validated here. Following the dashboard link runs
 * the destination's own `requireUser()`, which already redirects through the
 * validated `next` mechanism — one authorization authority, no second one on a
 * 404 page.
 */
export default async function NotFoundPage() {
  const hasSession = (await getSessionToken()) !== null;

  return (
    <main className="container mx-auto flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <h1 className="text-4xl font-bold tracking-tight text-foreground">404</h1>
      <p className="mt-2 text-lg text-muted-foreground">
        We could not find the page you were looking for.
      </p>
      <nav
        aria-label="Suggested destinations"
        className="mt-4 flex flex-col items-center gap-1 sm:flex-row sm:gap-4"
      >
        <Link href="/exercises" className={NOT_FOUND_LINK}>
          Browse the exercise catalog
        </Link>
        {hasSession ? (
          <Link href="/dashboard" className={NOT_FOUND_LINK}>
            Go to your dashboard
          </Link>
        ) : (
          <Link href="/login" className={NOT_FOUND_LINK}>
            Sign in
          </Link>
        )}
      </nav>
    </main>
  );
}

/** Shared link treatment: 44px touch target plus the standard focus ring. */
const NOT_FOUND_LINK =
  'inline-flex min-h-11 items-center rounded-control px-1 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50';
