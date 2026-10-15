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
 */
export interface AppNavLinksProps {
  readonly isAuthenticated: boolean;
  /**
   * `desktop` (default) is the wide header row. `mobileHeader` is the compact
   * row the mobile header renders for signed-out visitors (public destinations
   * + 44px touch targets); signed-in mobile navigation is the tab bar's job.
   */
  readonly variant?: 'desktop' | 'mobileHeader';
}

export function AppNavLinks({ isAuthenticated, variant = 'desktop' }: AppNavLinksProps) {
  const pathname = usePathname();
  const items = visibleNavItems(isAuthenticated);

  return (
    <nav
      aria-label="Primary"
      className={variant === 'desktop' ? 'flex items-center gap-7' : 'flex min-w-0 flex-1 items-center gap-1'}
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
                : 'flex min-h-11 items-center px-2 text-sm',
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
