import Link from 'next/link';
import type { ReactNode } from 'react';

import { AppNavLinks } from '@/components/shared/AppNavLinks';
import { Wordmark } from '@/components/shared/Wordmark';

/**
 * Mobile application header (locked design): h64 surface bar with bottom
 * border - wordmark on the left, the account control (or sign-in link) on the
 * right. Presentation-only, like AppHeader: the authenticated control is an
 * `account` slot composed by the route-group layout.
 *
 * M19 S3: signed-out visitors get the public destinations (Programs,
 * Exercises) here, rendered by the same AppNavLinks component filtered to
 * public entries — because the bottom tab bar is hidden for them. Signed-in
 * visitors get NO header nav: their navigation is the four-tab bar, which owns
 * the single visible "Primary" landmark on that breakpoint.
 */
export interface MobileHeaderProps {
  /** Authenticated account control, or null for signed-out visitors. */
  readonly account: ReactNode | null;
  /** Server-resolved session state; selects the visible destinations. */
  readonly isAuthenticated: boolean;
}

export function MobileHeader({ account, isAuthenticated }: MobileHeaderProps) {
  return (
    <header className="flex h-16 items-center justify-between gap-3 border-b border-border bg-card px-5 md:hidden">
      {/* M19 S3 review P2: same wordmark rule as the desktop header — the
          public home route for signed-out visitors, /dashboard when signed in. */}
      <Wordmark href={isAuthenticated ? '/dashboard' : '/'} className="text-xl" />
      {!isAuthenticated && <AppNavLinks isAuthenticated={false} variant="mobileHeader" />}
      {account ?? (
        <Link
          href="/login"
          className="rounded-sm py-2 text-[15px] font-medium text-ink-2 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Sign in
        </Link>
      )}
    </header>
  );
}
