import type { EquipmentType } from '@/domain/types/exercise';
import type { WorkoutDetailView } from '@/features/sessions/workout-detail-view';
import { WorkoutDetailHeader } from '@/features/sessions/components/WorkoutDetailHeader';
import { WorkoutExerciseRow } from '@/features/sessions/components/WorkoutExerciseRow';
import { WorkoutStartPanel } from '@/features/sessions/components/WorkoutStartPanel';

interface WorkoutDetailProps {
  readonly view: WorkoutDetailView;
}

/**
 * Workout detail screen (locked design): breadcrumb + title + meta badges,
 * the compact exercise list inside one surface card ("Exercises" head with
 * the advisory copy), and the accent-tint CTA band.
 *
 * Composition only — all data arrives as the pre-assembled
 * {@link WorkoutDetailView}; the exercise rows stay compact (locked design),
 * not large cards.
 */
export function WorkoutDetail({ view }: WorkoutDetailProps) {
  const { workout } = view;
  const programSlug = workout.programSlug;

  const equipmentSummary: EquipmentType[] = [];
  for (const exercise of workout.workout.exercises) {
    if (!equipmentSummary.includes(exercise.equipment)) {
      equipmentSummary.push(exercise.equipment);
    }
  }

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <WorkoutDetailHeader workout={workout} equipmentSummary={equipmentSummary} />

      <section
        aria-labelledby="exercises-heading"
        className="rounded-card border border-border bg-card px-5 pb-6 pt-4 md:px-8 md:pb-6 md:pt-2"
      >
        <div className="flex flex-col gap-1 border-b border-border pb-4 pt-4 md:flex-row md:items-baseline md:justify-between md:gap-4">
          <h2 id="exercises-heading" className="font-display text-xl font-semibold text-ink">
            Exercises
          </h2>
          <p className="text-[13px] text-ink-3 md:text-sm">
            Load recommendations appear only for externally loaded exercises — always advisory.
          </p>
        </div>

        <ol className="divide-y divide-border">
          {workout.workout.exercises.map((exercise, index) => (
            <WorkoutExerciseRow
              key={exercise.order}
              exercise={exercise}
              target={
                view.targets[index] ?? {
                  exerciseId: '',
                  lastTimeLabel: null,
                  lastTimeCompactLabel: null,
                  chip: null,
                }
              }
            />
          ))}
        </ol>
      </section>

      <WorkoutStartPanel
        programSlug={programSlug}
        weekNumber={workout.weekNumber}
        workoutOrder={workout.order}
        ctaState={view.ctaState}
      />
    </div>
  );
}
