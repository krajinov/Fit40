'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { isActivePath, visibleNavItems } from '@/components/shared/nav-items';
import { cn } from '@/lib/utils';

/**
 * Header navigation links (locked design). Client-only because active state
 * needs usePathname.
 *
 * M19 S3: the destination list and the auth filter live in `nav-items.ts`, and
 * the authentication state arrives as a prop resolved by the route-group
 * layout on the server — so a signed-out visitor is never shown a private
 * destination, in the server HTML or after hydration, and no second client-side
 * auth state exists.
 *
 * M19 S4: the compact `mobileHeader` row is the one place where the wordmark,
 * the public destinations and the sign-in control must share a 320px-class row
 * at a user-enlarged font size.
 *
 * M19 S4 review fix (P2 — the labels disappeared): the compact row no longer
 * truncates. Its links keep their full labels (`shrink-0`, no `truncate`), the
 * nav is itself a wrapping row, and the header around it wraps too — so when the
 * wordmark + both destinations + the sign-in control cannot share one line, the
 * destinations move to a second navigation row (and stack individually only at
 * the largest text sizes) with their labels fully readable. Every link keeps the
 * `min-h-11` 44px touch-target floor, and no combination of width and text size
 * produces horizontal page overflow or overlapping controls.
 *
 * M19 S4 review fix (P2 — visual order vs keyboard order): the compact nav is
 * deliberately NOT `flex-1`. A growing/shrinking nav is placed on the header's
 * first flex line with a near-zero basis, then wraps ITS OWN links into a narrow
 * column while the account control keeps sharing that line — which renders the
 * second destination (`Exercises`) BELOW the sign-in control even though it
 * comes BEFORE it in the DOM and in the tab order. Keeping the nav at its
 * natural width means the header's own line breaking moves the whole nav onto a
 * following row that precedes the account row, so the visual reading order and
 * the keyboard focus order always agree. Nothing is reordered with CSS `order`
 * or `tabindex`: the DOM order is the only order there is.
 */
export interface AppNavLinksProps {
  readonly isAuthenticated: boolean;
  /**
   * `desktop` (default) is the wide header row. `mobileHeader` is the compact
   * wrapping row the mobile header renders for signed-out visitors (public
   * destinations + 44px touch targets); signed-in mobile navigation is the tab
   * bar's job.
   */
  readonly variant?: 'desktop' | 'mobileHeader';
}

export function AppNavLinks({ isAuthenticated, variant = 'desktop' }: AppNavLinksProps) {
  const pathname = usePathname();
  const items = visibleNavItems(isAuthenticated);

  return (
    <nav
      aria-label="Primary"
      className={
        variant === 'desktop'
          ? 'flex items-center gap-7'
          : // No `flex-1`: the compact nav keeps its natural width so the HEADER's
            // line breaking (not the nav's own) decides where the row ends, which
            // keeps visual order identical to DOM/tab order. See the file header.
            'flex flex-wrap items-center gap-1'
      }
    >
      {items.map((item) => {
        const active = isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
              variant === 'desktop'
                ? 'text-[15px]'
                : 'flex min-h-11 shrink-0 items-center px-1 text-sm',
              active
                ? 'font-semibold text-foreground'
                : 'font-medium text-ink-2 hover:text-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
