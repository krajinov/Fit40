import type { Metadata } from 'next';

import { PageContainer } from '@/components/shared/PageContainer';
import { requireUser } from '@/features/auth/current-user';
import { ProgressScreen } from '@/features/progress/components/ProgressScreen';
import { PROGRESS_HEADING, PROGRESS_SUBHEADING } from '@/features/progress/progress-labels';
import { buildProgressView } from '@/features/progress/progress-view';

export const metadata: Metadata = {
  title: 'Progress',
};

/**
 * The Progress route (M18 Slice 4): a dedicated, user-global long-horizon
 * surface. Deliberately thin — one authenticated user, one request clock, one
 * composed read, one screen. The horizon and every metric are resolved by the
 * Application and Domain layers; nothing here (and nothing in the components)
 * re-derives a week or a total.
 */
export default async function ProgressPage() {
  const user = await requireUser('/progress');

  // Single request clock: the Domain resolves the 13-week horizon from this
  // instant. No other `Date.now()` / `new Date()` runs in the request path.
  const now = new Date();
  const state = await buildProgressView(user.id, now);

  return (
    <PageContainer>
      <header className="mb-8 space-y-2">
        <h1 className="font-display text-[26px] font-bold tracking-tight text-foreground md:text-4xl">
          {PROGRESS_HEADING}
        </h1>
        <p className="max-w-2xl text-sm text-ink-2 md:text-base">{PROGRESS_SUBHEADING}</p>
      </header>

      <ProgressScreen state={state} />
    </PageContainer>
  );
}
