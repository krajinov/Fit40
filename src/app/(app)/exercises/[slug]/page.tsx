import { cache } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { notFound } from 'next/navigation';

import { PageContainer } from '@/components/shared/PageContainer';
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
    <PageContainer className="pt-5 md:pt-8">
      <nav aria-label="Breadcrumb" className="mb-6">
        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
          <li>
            <Link
              href="/exercises"
              className="rounded-control text-ink-3 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Exercises
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-4 shrink-0 text-ink-3" />
          </li>
          <li aria-current="page" className="font-medium text-foreground">
            {result.data.name}
          </li>
        </ol>
      </nav>

      <ExerciseDetail exercise={result.data} />
    </PageContainer>
  );
}