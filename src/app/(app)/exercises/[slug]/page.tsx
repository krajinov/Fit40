import { cache } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getExerciseBySlugUseCase } from '@/features/exercises/services';
import { ExerciseDetail } from '@/features/exercises/components/ExerciseDetail';
import { exerciseSlugSchema } from '@/features/exercises/schemas/exercise-filters-schema';

interface ExerciseDetailPageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

const getExercise = cache(async (slug: string) => {
  return getExerciseBySlugUseCase.execute(slug);
});

export async function generateMetadata({ params }: ExerciseDetailPageProps) {
  const { slug } = await params;
  const result = await getExercise(slug);

  if (!result.ok) {
    return { title: 'Exercise not found' };
  }

  return { title: result.data.name };
}

export default async function ExerciseDetailPage({ params }: ExerciseDetailPageProps) {
  const { slug } = await params;

  const slugResult = exerciseSlugSchema.safeParse(slug);
  if (!slugResult.success) {
    notFound();
  }

  const result = await getExercise(slug);
  if (!result.ok) {
    notFound();
  }

  return (
    <main className="container mx-auto flex-1 px-4 py-8 sm:py-12">
      <ExerciseDetail exercise={result.data} />
      <div className="mt-8">
        <Link
          href="/exercises"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← Back to catalog
        </Link>
      </div>
    </main>
  );
}