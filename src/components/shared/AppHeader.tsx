import Link from 'next/link';

import { AppNavLinks } from '@/components/shared/AppNavLinks';
import { Wordmark } from '@/components/shared/Wordmark';

/**
 * Desktop application header (locked design): h76 surface bar with bottom
 * border - wordmark, primary nav links and a profile pill (or sign-in link
 * for unauthenticated visitors on public catalog pages).
 *
 * Presentation-only: this component never enforces authentication. Private
 * pages keep their own requireUser() guards; the header only renders what the
 * session (if any) provides.
 */
export interface AppHeaderProps {
  readonly userEmail: string | null;
}

function initialOf(email: string): string {
  return (email[0] ?? '').toUpperCase();
}

export function AppHeader({ userEmail }: AppHeaderProps) {
  return (
    <header className="hidden h-[76px] border-b border-border bg-card md:block">
      <div className="mx-auto flex h-full w-full max-w-[1120px] items-center gap-10 px-5 md:px-8">
        <Wordmark />
        <AppNavLinks />
        <div className="flex flex-1 items-center justify-end">
          {userEmail === null ? (
            <Link
              href="/login"
              className="rounded-sm py-2 text-[15px] font-medium text-ink-2 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Sign in
            </Link>
          ) : (
            <Link
              href="/profile"
              className="flex items-center gap-2.5 rounded-pill border border-border py-1.5 pr-3 pl-1.5 outline-none transition-colors hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span
                aria-hidden="true"
                className="grid size-7 place-items-center rounded-pill bg-accent-tint text-[13px] font-semibold text-accent-strong"
              >
                {initialOf(userEmail)}
              </span>
              <span className="text-sm font-medium text-ink-2">Profile</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
