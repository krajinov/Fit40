import { Dumbbell } from 'lucide-react';

import type { ExerciseSummaryDto } from '@/application/dto/exercise';
import { EmptyState } from '@/components/shared/EmptyState';
import { ExerciseCard } from './ExerciseCard';

interface ExerciseListProps {
  readonly exercises: ReadonlyArray<ExerciseSummaryDto>;
}

export function ExerciseList({ exercises }: ExerciseListProps) {
  return (
    <section aria-label="Exercise results" className="space-y-4">
      <p aria-live="polite" className="text-sm text-ink-2">
        {exercises.length} {exercises.length === 1 ? 'exercise' : 'exercises'}
      </p>

      {exercises.length === 0 ? (
        <EmptyState
          icon={<Dumbbell aria-hidden="true" className="size-8" />}
          title="No exercises found"
          body="No exercises match the current filters. Try removing a filter to see more of the catalog."
        />
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {exercises.map((exercise) => (
            <li key={exercise.slug} className="flex flex-col">
              <ExerciseCard exercise={exercise} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}