import Link from 'next/link';
import { Dumbbell } from 'lucide-react';

import { Badge } from '@/components/shared/Badge';
import { cn } from '@/lib/utils';
import type { CompletedWorkoutEntry } from '@/features/dashboard/dashboard-view';

interface RecentTrainingCardProps {
  readonly programSlug: string;
  readonly completedWorkouts: ReadonlyArray<CompletedWorkoutEntry>;
  readonly className?: string;
}

/**
 * "Recent training" card (locked design minus history dates/volume).
 *
 * The locked design lists completed sessions with date, set count and
 * volume totals. No session-history listing is exposed by the application
 * layer, so the card lists the completed workouts truthfully by name and
 * program coordinates. The design's "View history" link is omitted for the
 * same reason — no history screen exists yet.
 *
 * The list is capped for scannability (completed workouts shown in
 * completion order, newest first).
 */
export const RECENT_TRAINING_LIMIT = 3;

export function RecentTrainingCard({
  programSlug,
  completedWorkouts,
  className,
}: RecentTrainingCardProps) {
  const recent = completedWorkouts.slice(-RECENT_TRAINING_LIMIT).reverse();

  return (
    <section
      aria-label="Recent training"
      className={cn('flex flex-col gap-4 rounded-card border border-border bg-card p-8', className)}
    >
      <h2 className="font-display text-xl font-semibold text-foreground">Recent training</h2>

      {recent.length === 0 ? (
        <p className="text-sm text-ink-2">
          No completed workouts yet. Finish your first session and it will appear here.
        </p>
      ) : (
        <ol className="flex flex-col">
          {recent.map((workout) => (
            <li
              key={`${workout.weekNumber}-${workout.workoutOrder}`}
              className="flex items-center gap-4 border-b border-border py-4 last:border-b-0 last:pb-0 first:pt-0"
            >
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-control bg-accent-tint"
              >
                <Dumbbell className="size-[18px] text-accent-strong" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[15px] text-foreground">{workout.workoutName}</span>
                <span className="text-sm text-ink-2">
                  Week {workout.weekNumber} · Workout {workout.workoutOrder}
                </span>
              </span>
              <Badge variant="done">Completed</Badge>
            </li>
          ))}
        </ol>
      )}

      {completedWorkouts.length > RECENT_TRAINING_LIMIT && (
        <Link
          href={`/programs/${programSlug}`}
          className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          View program progress
        </Link>
      )}
    </section>
  );
}
