import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Dumbbell } from 'lucide-react';
import { Suspense } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageContainer } from '@/components/shared/PageContainer';
import { RoutePlaceholder } from '@/components/shared/RoutePlaceholder';
import { cn } from '@/lib/utils';
import { requireUser } from '@/features/auth/current-user';
import { HistoryExerciseShortcuts } from '@/features/history/components/HistoryExerciseShortcuts';
import { HistorySessionCard } from '@/features/history/components/HistorySessionCard';
import { HistoryTotalsCard } from '@/features/history/components/HistoryTotalsCard';
import { buildHistoryView } from '@/features/history/history-view';
import { parseHistoryPageQuery } from '@/features/history/schemas/history-page-schema';

export const metadata: Metadata = {
  title: 'Training history',
};

interface HistoryPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * M19 S2 review fix: requireUser() runs BEFORE this page returns any JSX and no
 * segment `loading.tsx` exists in the (app) chain (this boundary used to be
 * inherited by /history/exercises/[slug] as well), so signed-out cold requests
 * receive a native 307. A tampered/stale pagination cursor keeps its native
 * 404 below by being awaited before anything streams.
 */
export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const user = await requireUser('/history');
  const { cursor } = parseHistoryPageQuery(await searchParams);

  // Started once; both branches below consume the same request promise.
  const viewPromise = buildHistoryView(user.id, cursor);

  if (cursor !== null) {
    // Paginated navigation: only a cursor param can fail validation (a
    // tampered or stale token → INVALID_INPUT), and awaiting it HERE — before
    // any JSX is returned — keeps that a native 404, exactly as before
    // loading.tsx existed. A first-page request (cursor null) cannot be
    // invalid, so the heavy three-read view streams behind the placeholder.
    const viewResult = await viewPromise;
    if (!viewResult.ok) {
      notFound();
    }
    return <HistoryContent viewPromise={viewPromise} />;
  }

  return (
    <Suspense
      fallback={
        <PageContainer>
          <RoutePlaceholder
            label="Loading training history"
            blocks={['h-9 w-64 max-w-full', 'h-5 w-72 max-w-full', 'h-36', 'h-24', 'h-24', 'h-24']}
          />
        </PageContainer>
      }
    >
      <HistoryContent viewPromise={viewPromise} />
    </Suspense>
  );
}

interface HistoryContentProps {
  readonly viewPromise: ReturnType<typeof buildHistoryView>;
}

async function HistoryContent({ viewPromise }: HistoryContentProps) {
  const viewResult = await viewPromise;
  // Unreachable: a first page (null cursor) cannot be INVALID_INPUT, and a
  // paginated request already checked above. Kept so the child is total.
  if (!viewResult.ok) {
    notFound();
  }
  const view = viewResult.data;

  return (
    <PageContainer>
      <header className="space-y-2">
        <h1 className="font-display text-[26px] font-bold tracking-tight text-foreground md:text-4xl">
          Training history
        </h1>
        <p className="max-w-2xl text-sm text-ink-2 md:text-base">
          Every completed workout across your programs, newest first.
        </p>
      </header>

      <div className="mt-6 flex flex-col gap-5 md:mt-8 md:gap-6">
        <HistoryTotalsCard totals={view.totals} />

        {/* Derived shortcuts into the exercises performed in this page (no
            extra session read, one batched catalog lookup). Renders nothing
            when nothing was trained. */}
        <HistoryExerciseShortcuts shortcuts={view.exerciseShortcuts} />

        {view.sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-6">
            <EmptyState
              icon={<Dumbbell aria-hidden="true" className="size-8" />}
              title="No completed workouts yet"
              body="Completed workouts will appear here after you finish a session. Browse the programs to find one to start."
            />
            <Link href="/programs" className={buttonVariants({ variant: 'default' })}>
              Browse programs
            </Link>
          </div>
        ) : (
          <>
            <section
              aria-labelledby="history-sessions-heading"
              className="flex flex-col gap-4"
            >
              <h2
                id="history-sessions-heading"
                className="font-display text-xl font-semibold text-foreground"
              >
                Completed workouts
              </h2>
              <ol className="flex flex-col gap-4">
                {view.sessions.map((session) => (
                  <HistorySessionCard key={session.sessionId} session={session} />
                ))}
              </ol>
            </section>

            {view.olderPageHref !== null && (
              <Link
                href={view.olderPageHref}
                className={cn(buttonVariants({ variant: 'secondary' }), 'self-center')}
              >
                Load older workouts
              </Link>
            )}
          </>
        )}
      </div>
    </PageContainer>
  );
}
