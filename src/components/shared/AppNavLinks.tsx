'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/programs', label: 'Programs' },
  { href: '/exercises', label: 'Exercises' },
] as const;

/**
 * Desktop navigation links (locked design): Inter 15, active 600/ink,
 * inactive 500/ink-2. Client-only because active state needs usePathname.
 */
export function AppNavLinks() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex items-center gap-7">
      {NAV_LINKS.map((link) => {
        const active =
          pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-sm text-[15px] outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
              active
                ? 'font-semibold text-foreground'
                : 'font-medium text-ink-2 hover:text-foreground',
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
