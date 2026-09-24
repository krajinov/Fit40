import Link from 'next/link';
import type { ReactNode } from 'react';

import { AppNavLinks } from '@/components/shared/AppNavLinks';
import { Wordmark } from '@/components/shared/Wordmark';

/**
 * Desktop application header (locked design): h76 surface bar with bottom
 * border - wordmark, primary nav links and the account control (or a sign-in
 * link for unauthenticated visitors on public catalog pages).
 *
 * Presentation-only: this component never enforces authentication and knows
 * nothing about sessions or features. The authenticated control arrives as an
 * `account` slot composed by the route-group layout (the global account menu),
 * which is what keeps the shared shell free of feature imports.
 */
export interface AppHeaderProps {
  /** Authenticated account control, or null for signed-out visitors. */
  readonly account: ReactNode | null;
}

export function AppHeader({ account }: AppHeaderProps) {
  return (
    <header className="hidden h-[76px] border-b border-border bg-card md:block">
      <div className="mx-auto flex h-full w-full max-w-[1120px] items-center gap-10 px-5 md:px-8">
        <Wordmark />
        <AppNavLinks />
        <div className="flex flex-1 items-center justify-end">
          {account ?? (
            <Link
              href="/login"
              className="rounded-sm py-2 text-[15px] font-medium text-ink-2 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
