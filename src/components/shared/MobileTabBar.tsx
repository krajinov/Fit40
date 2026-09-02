'use client';

import { Dumbbell, Home, ListChecks, UserRound, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

const TABS: ReadonlyArray<{
  href: string;
  label: string;
  icon: LucideIcon;
}> = [
  { href: '/dashboard', label: 'Home', icon: Home },
  { href: '/programs', label: 'Programs', icon: Dumbbell },
  { href: '/exercises', label: 'Exercises', icon: ListChecks },
  { href: '/profile', label: 'Profile', icon: UserRound },
];

/**
 * Mobile bottom tab bar (locked design): h76 surface bar with top border,
 * four tabs (icon 22 + Inter 12 label), active tab in accent. Fixed to the
 * viewport bottom with safe-area padding; hidden at md and up. Client-only
 * because active state needs usePathname.
 *
 * The Active Workout screen (any `/session` route) hides the tab bar and
 * shows the screen's own finish action bar in the same position instead —
 * the locked mobile frame for that screen carries only the finish bar.
 */
export function MobileTabBar() {
  const pathname = usePathname();

  if (pathname.endsWith('/session')) {
    return null;
  }

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="flex h-[76px] items-stretch gap-2 px-2 pt-2 pb-4">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-1 rounded-control outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
                active ? 'text-primary' : 'text-ink-3 hover:text-ink-2',
              )}
            >
              <Icon aria-hidden="true" className="size-[22px]" />
              <span className={cn('text-xs', active ? 'font-semibold' : 'font-medium')}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
