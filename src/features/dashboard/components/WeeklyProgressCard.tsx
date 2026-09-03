import { ProgressBar } from '@/components/shared/ProgressBar';
import { cn } from '@/lib/utils';
import type { WeekSummary } from '@/features/dashboard/dashboard-view';

interface WeeklyProgressCardProps {
  readonly programName: string;
  readonly currentWeek: WeekSummary | null;
  readonly className?: string;
}

/**
 * "This week" card (locked design minus the calendar day dots).
 *
 * The locked design shows Mon–Sun dots keyed to calendar scheduling, which
 * the domain does not have: programs schedule workouts per program-week,
 * not per weekday, and no completion dates are exposed for a week.
 * Progress is therefore shown truthfully for the current program week.
 */
export function WeeklyProgressCard({
  programName,
  currentWeek,
  className,
}: WeeklyProgressCardProps) {
  if (currentWeek === null) {
    return null;
  }

  const percentage =
    currentWeek.totalWorkouts === 0
      ? 0
      : Math.round((currentWeek.completedCount / currentWeek.totalWorkouts) * 100);

  return (
    <section
      aria-label="This week"
      className={cn(
        'flex flex-col gap-4 rounded-card border border-border bg-card p-6 md:gap-6 md:p-8',
        className,
      )}
    >
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h2 className="font-display text-lg font-semibold text-foreground md:text-xl">
            This week
          </h2>
          <p className="text-sm text-ink-2">
            Week {currentWeek.weekNumber} of {programName}: {currentWeek.completedCount} of{' '}
            {currentWeek.totalWorkouts}{' '}
            {currentWeek.totalWorkouts === 1 ? 'workout' : 'workouts'} completed
          </p>
        </div>
        <p className="font-display text-lg font-semibold text-primary md:text-xl">{percentage}%</p>
      </div>
      <ProgressBar
        value={percentage}
        label={`Week ${currentWeek.weekNumber} progress`}
        thin
      />
    </section>
  );
}
