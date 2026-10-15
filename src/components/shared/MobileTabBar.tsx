'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { authenticatedMobileTabs, isActivePath } from '@/components/shared/nav-items';
import { cn } from '@/lib/utils';

/**
 * Mobile bottom tab bar (locked design): h76 surface bar with top border,
 * four tabs (icon 22 + Inter 12 label), active tab in accent. Fixed to the
 * viewport bottom with safe-area padding; hidden at md and up. Client-only
 * because active state needs usePathname.
 *
 * M19 S3: the four authenticated tabs are Home / Programs / Exercises /
 * Progress, declared in `nav-items.ts`. Profile is NOT a tab — it stays
 * reachable from the account menu in both headers (its pre-hydration fallback
 * is a native `/profile` link). For a signed-out visitor the bar renders
 * nothing at all: private destinations must never be presented as available
 * navigation. The state arrives as a server-resolved prop, so the server HTML
 * is already correct and hydration never switches the bar on.
 *
 * The Active Workout screen (any `/session` route) hides the tab bar and
 * shows the screen's own finish action bar in the same position instead —
 * the locked mobile frame for that screen carries only the finish bar.
 *
 * M19 S4 (mobile navigation integrity): the 76px slot is a FIXED-pixel
 * geometry — the vertical padding is written in px (`pt-[8px] pb-[16px]`)
 * precisely so a larger user base font size cannot consume the slot and
 * shrink the tap targets below the 44px floor. The label text still scales
 * with the user's font size (it is `text-xs`), and each tab is `min-w-0` with
 * a truncating label so four slots can never force horizontal page scroll on
 * a 320px-class screen with enlarged text.
 */
export interface MobileTabBarProps {
  readonly isAuthenticated: boolean;
}

export function MobileTabBar({ isAuthenticated }: MobileTabBarProps) {
  const pathname = usePathname();

  if (!isAuthenticated) {
    return null;
  }

  if (pathname.endsWith('/session')) {
    return null;
  }

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="flex h-[76px] items-stretch gap-2 px-2 pt-[8px] pb-[16px]">
        {authenticatedMobileTabs().map((tab) => {
          const active = isActivePath(pathname, tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-control outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
                active ? 'text-primary' : 'text-ink-3 hover:text-ink-2',
              )}
            >
              <Icon aria-hidden="true" className="size-[22px] shrink-0" />
              <span
                className={cn(
                  'max-w-full min-w-0 truncate text-xs',
                  active ? 'font-semibold' : 'font-medium',
                )}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
