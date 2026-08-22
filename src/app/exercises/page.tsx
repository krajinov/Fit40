import { Suspense } from 'react';
import type { Metadata } from 'next';

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
    <main className="container mx-auto flex-1 px-4 py-8 sm:py-12">
      <div className="mb-8 space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Exercise Catalog
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Browse exercises by equipment, muscle group, or difficulty. Filter
          using the controls below; the URL updates automatically so you can
          share your selections.
        </p>
      </div>

      <div className="mb-8">
        <Suspense fallback={<div className="h-40 rounded-xl border border-dashed border-border" />}>
          <ExerciseFilters />
        </Suspense>
      </div>

      <ExerciseList exercises={exercises} />
    </main>
  );
}