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
 *
 * M19 S4: the row gap is 8px (not 12px) and the sign-in control carries a
 * fixed 44px floor.
 *
 * M19 S4 review fix (P2 — the public labels disappeared): the compact row is now
 * a WRAPPING row (`flex-wrap`, `min-h-16`). The wordmark and the account /
 * sign-in control keep a single line whenever they fit, and the public
 * destinations move to a second row (and, at the largest text sizes, their own
 * additional line) instead of being squeezed until their labels vanish. The
 * header grows vertically only when it has to; at the default text size the row
 * is still exactly one 64px bar.
 *
 * M19 S4 review fix (P2 — visual order vs keyboard order): because the header
 * wraps as whole ITEMS (the compact nav is no longer `flex-1`, see
 * `AppNavLinks`), the wordmark, the destinations and the sign-in control always
 * appear — and receive keyboard focus — in the same order: Fit40 → Programs →
 * Exercises → Sign in. The header's own flex lines decide the row breaks, so no
 * `order` utility or `tabindex` is needed to reconcile the two sequences.
 */
export interface MobileHeaderProps {
  /** Authenticated account control, or null for signed-out visitors. */
  readonly account: ReactNode | null;
  /** Server-resolved session state; selects the visible destinations. */
  readonly isAuthenticated: boolean;
}

export function MobileHeader({ account, isAuthenticated }: MobileHeaderProps) {
  return (
    <header className="flex min-h-16 flex-wrap items-center justify-between gap-x-1.5 gap-y-1 border-b border-border bg-card px-5 py-1 md:hidden">
      {/* M19 S3 review P2: same wordmark rule as the desktop header — the
          public home route for signed-out visitors, /dashboard when signed in. */}
      <Wordmark href={isAuthenticated ? '/dashboard' : '/'} className="shrink-0 text-xl" />
      {!isAuthenticated && <AppNavLinks isAuthenticated={false} variant="mobileHeader" />}
      {/* `ml-auto` keeps the account control right-aligned in the single-row
          layout and on a wrapped row of its own. */}
      <div className="ml-auto flex items-center">
        {account ?? (
          <Link
            href="/login"
            className="inline-flex min-h-[44px] items-center rounded-sm px-1 py-2 text-[15px] font-medium text-ink-2 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
