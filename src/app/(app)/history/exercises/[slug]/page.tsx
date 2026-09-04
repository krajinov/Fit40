import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, Dumbbell } from 'lucide-react';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { EmptyState } from '@/components/shared/EmptyState';
import { PageContainer } from '@/components/shared/PageContainer';
import { SectionCard } from '@/components/shared/SectionCard';
import { getCurrentUser, requireUser } from '@/features/auth/current-user';
import { ExerciseHistoryOccurrenceList } from '@/features/history/components/ExerciseHistoryOccurrenceList';
import { ExerciseHistoryTrend } from '@/features/history/components/ExerciseHistoryTrend';
import { buildExerciseHistoryView } from '@/features/history/exercise-history-view';
import { exerciseHistoryParamsSchema } from '@/features/history/schemas/exercise-history-page-schema';

interface ExerciseHistoryPageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

/**
 * Request-scoped dedup of the exercise-history build: generateMetadata and
 * the page render both need the same view for the same (userId, slug), and
 * without cache() the repository read would run twice per request.
 * React's cache() is per-request only — nothing is cached across requests —
 * and the key is the full argument pair (authenticated userId + slug).
 */
const exerciseHistoryView = cache(buildExerciseHistoryView);

export async function generateMetadata({
  params,
}: ExerciseHistoryPageProps): Promise<Metadata> {
  const parsed = exerciseHistoryParamsSchema.safeParse(await params);
  if (!parsed.success) {
    return { title: 'Exercise history' };
  }

  const user = await getCurrentUser();
  if (user === null) {
    return { title: 'Exercise history' };
  }

  const viewResult = await exerciseHistoryView(user.id, parsed.data.slug);
  return {
    title: viewResult.ok ? `${viewResult.data.heading} history` : 'Exercise history',
  };
}

export default async function ExerciseHistoryPage({ params }: ExerciseHistoryPageProps) {
  const { slug } = await params;

  const paramsResult = exerciseHistoryParamsSchema.safeParse({ slug });
  if (!paramsResult.success) {
    notFound();
  }

  // Private page: auth is enforced here (the (app) layout deliberately
  // enforces nothing). The trusted session supplies the userId — never the
  // URL — so history can only ever be the viewer's own.
  const user = await requireUser(`/history/exercises/${paramsResult.data.slug}`);

  const viewResult = await exerciseHistoryView(user.id, paramsResult.data.slug);
  // EXERCISE_NOT_FOUND addresses an unknown slug — a 404. A known exercise
  // with no user history is NOT an error: the view carries empty entries.
  if (!viewResult.ok) {
    notFound();
  }
  const view = viewResult.data;

  return (
    <PageContainer>
      <nav aria-label="Breadcrumb" className="mb-6">
        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
          <li>
            <Link
              href="/history"
              className="rounded-control text-ink-3 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              History
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-4 shrink-0 text-ink-3" />
          </li>
          <li aria-current="page" className="font-medium text-foreground">
            {view.heading}
          </li>
        </ol>
      </nav>

      <header className="space-y-2">
        <p className="text-xs font-semibold tracking-wide text-accent-foreground">
          {view.equipmentLabel} · {view.occurrenceCountLabel}
        </p>
        <h1 className="font-display text-[26px] font-bold tracking-tight text-foreground md:text-4xl">
          {view.heading}
        </h1>
        <p className="max-w-2xl text-sm text-ink-2 md:text-base">
          Your completed performances of this exercise across every program,
          newest first.
        </p>
      </header>

      {view.entries.length === 0 ? (
        <div className="mt-6 md:mt-8">
          <EmptyState
            icon={<Dumbbell aria-hidden="true" className="size-8" />}
            title="No history yet"
            body="You haven't performed this exercise in any completed workout. It will appear here the first time you finish a workout that includes it."
          />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6 md:mt-8">
          {view.trend !== null && (
            <SectionCard
              id="exercise-history-trend"
              title="Working-load trend"
            >
              <ExerciseHistoryTrend trend={view.trend} />
            </SectionCard>
          )}

          <section
            aria-labelledby="exercise-history-occurrences-heading"
            className="flex flex-col gap-4"
          >
            <h2
              id="exercise-history-occurrences-heading"
              className="font-display text-xl font-semibold text-foreground"
            >
              Completed performances
            </h2>
            <ExerciseHistoryOccurrenceList entries={view.entries} />
          </section>
        </div>
      )}
    </PageContainer>
  );
}
