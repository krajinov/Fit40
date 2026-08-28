import Link from 'next/link';

import { getCurrentUser } from '@/features/auth/current-user';
import { LogoutButton } from '@/features/auth/components/LogoutButton';

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      <main className="flex flex-col items-center gap-6 px-6 py-32 text-center">
        <h1 className="text-5xl font-bold tracking-tight">Fit40</h1>
        <p className="max-w-md text-xl text-muted-foreground">
          Strength, mobility and fitness for life after 40.
        </p>

        <nav className="flex flex-wrap items-center justify-center gap-3">
          {user === null ? (
            <>
              <Link
                href="/register"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Create account
              </Link>
              <Link
                href="/login"
                className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                Sign in
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/dashboard"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Dashboard
              </Link>
              <LogoutButton className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted" />
            </>
          )}
        </nav>
      </main>
    </div>
  );
}
