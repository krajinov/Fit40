import type { ExerciseSummaryDto } from '@/application/dto/exercise';
import { ExerciseCard } from './ExerciseCard';

interface ExerciseListProps {
  readonly exercises: ReadonlyArray<ExerciseSummaryDto>;
}

export function ExerciseList({ exercises }: ExerciseListProps) {
  return (
    <section aria-label="Exercise results" className="space-y-4">
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {exercises.length} {exercises.length === 1 ? 'exercise' : 'exercises'}
      </p>

      {exercises.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-muted-foreground">
            No exercises match the selected filters.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {exercises.map((exercise) => (
            <li key={exercise.slug}>
              <ExerciseCard exercise={exercise} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}