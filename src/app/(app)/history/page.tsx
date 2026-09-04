import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Dumbbell } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageContainer } from '@/components/shared/PageContainer';
import { cn } from '@/lib/utils';
import { requireUser } from '@/features/auth/current-user';
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

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const user = await requireUser('/history');
  const { cursor } = parseHistoryPageQuery(await searchParams);

  const viewResult = await buildHistoryView(user.id, cursor);
  // A cursor that fails validation is a tampered or stale URL — handled like
  // any other unresolvable route input.
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
