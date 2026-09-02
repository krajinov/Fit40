import Link from 'next/link';

import { Wordmark } from '@/components/shared/Wordmark';

/**
 * Mobile application header (locked design): h64 surface bar with bottom
 * border - wordmark on the left, avatar (or sign-in link) on the right.
 * Presentation-only, like AppHeader.
 */
export interface MobileHeaderProps {
  readonly userEmail: string | null;
}

function initialOf(email: string): string {
  return (email[0] ?? '').toUpperCase();
}

export function MobileHeader({ userEmail }: MobileHeaderProps) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-5 md:hidden">
      <Wordmark className="text-xl" />
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
          aria-label="Profile"
          className="grid size-8 place-items-center rounded-pill border border-accent-tint-border bg-accent-tint text-sm font-semibold text-accent-strong outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span aria-hidden="true">{initialOf(userEmail)}</span>
        </Link>
      )}
    </header>
  );
}
