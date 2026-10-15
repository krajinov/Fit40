import type { Metadata } from 'next';
import { Suspense } from 'react';

import { PageContainer } from '@/components/shared/PageContainer';
import { RoutePlaceholder } from '@/components/shared/RoutePlaceholder';
import { requireUser } from '@/features/auth/current-user';
import { ProgressScreen } from '@/features/progress/components/ProgressScreen';
import { PROGRESS_HEADING, PROGRESS_SUBHEADING } from '@/features/progress/progress-labels';
import { buildProgressRecordTimeline } from '@/features/progress/personal-best-timeline-view';
import { buildProgressView } from '@/features/progress/progress-view';

export const metadata: Metadata = {
  title: 'Progress',
};

/**
 * The Progress route (M18 Slice 4, extended by Slice 6): a dedicated,
 * user-global long-horizon surface. Deliberately thin — one authenticated
 * user, ONE request clock, two independent composed reads, one screen. The
 * horizon and every metric are resolved by the Application and Domain layers;
 * nothing here (and nothing in the components) re-derives a week, a total or a
 * record.
 *
 * The two reads are independent by design: either can degrade alone, so a
 * failed personal-best read never hides the activity the user did complete
 * (and vice versa). Both receive the same clock instance, so the whole request
 * describes one instant (memo invariant 7).
 */
/**
 * M19 S2 review fix: requireUser() runs BEFORE this page returns any JSX and
 * no segment `loading.tsx` exists in the (app) chain, so a signed-out cold
 * request receives a native 307 instead of a streamed 200 + meta-refresh. The
 * two composed reads stream behind an explicit Suspense boundary with the same
 * non-fabricated placeholder geometry as the deleted loading.tsx.
 */
export default async function ProgressPage() {
  const user = await requireUser('/progress');

  // Single request clock: the Domain resolves the 13-week horizon from this
  // instant. No other `Date.now()` / `new Date()` runs in the request path.
  const now = new Date();
  // Started, not awaited: the two composed reads are what stream.
  const viewsPromise = Promise.all([
    buildProgressView(user.id, now),
    buildProgressRecordTimeline(user.id, now),
  ]);

  return (
    <Suspense
      fallback={
        <PageContainer>
          <RoutePlaceholder
            label="Loading progress"
            blocks={['h-9 w-56 max-w-full', 'h-5 w-80 max-w-full', 'h-32', 'h-72', 'h-72']}
          />
        </PageContainer>
      }
    >
      <ProgressContent viewsPromise={viewsPromise} />
    </Suspense>
  );
}

interface ProgressContentProps {
  readonly viewsPromise: Promise<
    [
      Awaited<ReturnType<typeof buildProgressView>>,
      Awaited<ReturnType<typeof buildProgressRecordTimeline>>,
    ]
  >;
}

async function ProgressContent({ viewsPromise }: ProgressContentProps) {
  const [state, personalBests] = await viewsPromise;

  return (
    <PageContainer>
      <header className="mb-8 space-y-2">
        <h1 className="font-display text-[26px] font-bold tracking-tight text-foreground md:text-4xl">
          {PROGRESS_HEADING}
        </h1>
        <p className="max-w-2xl text-sm text-ink-2 md:text-base">{PROGRESS_SUBHEADING}</p>
      </header>

      <ProgressScreen state={state} personalBests={personalBests} />
    </PageContainer>
  );
}
