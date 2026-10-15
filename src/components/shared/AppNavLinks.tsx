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
          : 'flex flex-1 flex-wrap items-center gap-1'
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
