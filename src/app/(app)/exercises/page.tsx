import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageContainer } from '@/components/shared/PageContainer';
import { listExercisesUseCase } from '@/features/exercises/services';
import { ExerciseFilters } from '@/features/exercises/components/ExerciseFilters';
import { ExerciseList } from '@/features/exercises/components/ExerciseList';
import { parseExerciseFilters } from '@/features/exercises/schemas/exercise-filters-schema';

export const metadata: Metadata = {
  title: 'Exercise Catalog',
};

interface ExercisesPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ExercisesPage({ searchParams }: ExercisesPageProps) {
  const params = await searchParams;
  const criteria = parseExerciseFilters(params);
  const exercises = await listExercisesUseCase.execute(criteria);

  return (
    <PageContainer className="pt-10 md:pt-10">
      <header className="mb-8 space-y-2">
        <h1 className="font-display text-[26px] font-bold tracking-tight text-foreground md:text-4xl">
          Exercises
        </h1>
        <p className="max-w-2xl text-sm text-ink-2 md:text-base">
          Browse the exercise library and filter by equipment, muscle group, or
          difficulty. Filters are reflected in the URL, so any view can be
          bookmarked or shared.
        </p>
      </header>

      <div className="mb-8">
        <Suspense
          fallback={
            <div
              aria-hidden="true"
              className="h-40 rounded-card border border-border bg-surface-2/50"
            />
          }
        >
          <ExerciseFilters />
        </Suspense>
      </div>

      <ExerciseList exercises={exercises} />
    </PageContainer>
  );
}