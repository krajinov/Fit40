import Link from 'next/link';
import type { ReactNode } from 'react';

import { Wordmark } from '@/components/shared/Wordmark';

/**
 * Mobile application header (locked design): h64 surface bar with bottom
 * border - wordmark on the left, the account control (or sign-in link) on the
 * right. Presentation-only, like AppHeader: the authenticated control is an
 * `account` slot composed by the route-group layout.
 */
export interface MobileHeaderProps {
  /** Authenticated account control, or null for signed-out visitors. */
  readonly account: ReactNode | null;
}

export function MobileHeader({ account }: MobileHeaderProps) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-5 md:hidden">
      <Wordmark className="text-xl" />
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
