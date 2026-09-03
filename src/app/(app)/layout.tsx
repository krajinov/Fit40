import type { ReactNode } from 'react';

import { AppHeader } from '@/components/shared/AppHeader';
import { MobileHeader } from '@/components/shared/MobileHeader';
import { MobileTabBar } from '@/components/shared/MobileTabBar';
import { getCurrentUser } from '@/features/auth/current-user';

interface AppLayoutProps {
  readonly children: ReactNode;
}

/**
 * Shared application shell (desktop header, mobile header, mobile tab bar).
 *
 * AUTH OWNERSHIP DECISION: this layout is presentation-only and enforces
 * nothing. The group mixes intentionally PUBLIC routes (program catalog,
 * program detail, scheduled workout detail, exercise catalog) with private
 * ones, so a layout-level requireUser() would change authorization behavior.
 * Private pages keep their own requireUser() calls because they also need
 * the returned UserDto for data fetching and pass route-specific ?next=
 * deep links that a layout redirect cannot know.
 *
 * getCurrentUser() is cache()-deduplicated per request, so pages that
 * already resolve the user pay no extra session lookup.
 *
 * The page content area is the route group's single <main> landmark —
 * exactly one per page, since no (app) page renders its own.
 */
export default async function AppLayout({ children }: AppLayoutProps) {
  const user = await getCurrentUser();
  const userEmail = user === null ? null : user.email;

  return (
    <>
      <AppHeader userEmail={userEmail} />
      <MobileHeader userEmail={userEmail} />
      {/* The route group's single primary-content landmark: exactly one <main>
          per (app) page — no page renders its own. Bottom clearance for the
          fixed mobile tab bar (incl. safe area) is preserved. */}
      <main className="flex-1 pb-[calc(76px+env(safe-area-inset-bottom))] md:pb-0">
        {children}
      </main>
      <MobileTabBar />
    </>
  );
}
