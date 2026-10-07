import type { UnplacedNotPerformedWorkoutDto } from '@/application/dto/schedule';
import { cn } from '@/lib/utils';
import { UndoNotPerformedForm } from '@/features/schedule/components/UndoNotPerformedForm';

interface UnplacedNotPerformedListProps {
  readonly programSlug: string;
  readonly workouts: ReadonlyArray<UnplacedNotPerformedWorkoutDto>;
  readonly className?: string;
}

/**
 * Recorded occurrences that hold no current calendar row (M17 Slice 11).
 *
 * A distinct factual list — never planned cards: these rows have NO date, so
 * the markup carries authored identity and labels only (name, week number,
 * workout order) and never a `plannedDate`, a fabricated day or a status
 * derived here. Each row exposes exactly one control, `Undo`, which removes
 * the fact; after it succeeds the row disappears from this list on the next
 * read and no calendar date is invented in its place. No Move, no Start, no
 * date picker.
 *
 * Order is the DTO's authored program order, preserved as supplied.
 */
export function UnplacedNotPerformedList({
  programSlug,
  workouts,
  className,
}: UnplacedNotPerformedListProps) {
  if (workouts.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Recorded as not performed"
      className={cn('flex flex-col gap-3', className)}
    >
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-[15px] font-semibold text-foreground md:text-[17px]">
          Recorded as not performed
        </h3>
        <p className="text-[13px] text-ink-2">
          These workouts are recorded as not performed and have no calendar date right now.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {workouts.map((workout) => (
          <li
            key={workout.scheduledWorkoutId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-callout border border-border bg-background p-4"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[15px] font-semibold text-foreground">
                {workout.workoutName}
              </span>
              <span className="text-[13px] text-ink-3">
                Week {workout.weekNumber} &middot; Workout {workout.workoutOrder}
              </span>
            </div>
            <UndoNotPerformedForm
              programSlug={programSlug}
              weekNumber={workout.weekNumber}
              workoutOrder={workout.workoutOrder}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
