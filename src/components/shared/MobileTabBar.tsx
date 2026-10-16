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
 * M19 S4 (mobile navigation integrity): the bar keeps the locked 76px slot as a
 * FLOOR and grows only when an enlarged base font needs it. The vertical
 * padding is fixed-pixel (`pt-[8px] pb-[16px]`) so font scaling can never
 * consume the slot down to the point where the 44px touch-target floor is lost
 * (the pre-fix rem-scaled padding squeezed the slots to 40px at 150% text and
 * 28px at 200%), and the slot height comes from the shared
 * `--mobile-tab-bar-height` token — the same token the shell reserves as
 * content clearance — so the icon (22px), the gap and the label line box always
 * fit inside the bar instead of being clipped vertically at 200% text. Each tab
 * is `min-w-0` with a truncating label so four slots can never force horizontal
 * page scroll on a 320px-class screen with enlarged text; the full label stays
 * in the DOM, so the accessible name never degrades.
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
      <div className="flex min-h-[var(--mobile-tab-bar-height)] items-stretch gap-2 px-2 pt-[8px] pb-[16px]">
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
              {/* `shrink-0` keeps the label's line box at its natural height:
                  without it the flex item may be compressed vertically (the
                  `truncate` utility sets `overflow: hidden`, which zeroes the
                  automatic minimum size on the column's main axis) — the
                  clipping this review fix removes. */}
              <span
                className={cn(
                  'max-w-full min-w-0 shrink-0 truncate text-xs',
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
