import { RestartProgramButton } from '@/features/enrollment/components/RestartProgramButton';
import { cn } from '@/lib/utils';

interface ConcludedRunCalloutProps {
  readonly programSlug: string;
  readonly completedWorkouts: number;
  readonly notPerformedWorkouts: number;
  readonly restartAvailable: boolean;
  readonly className?: string;
}

/**
 * The concluded-but-incomplete state of the enrollment panel (M17 Slice 11).
 *
 * Factually restates what settled the run — completions and recorded
 * not-performed facts, as counts — and deliberately never borrows completion
 * vocabulary: no "completed the program", no percentage, no judgment. It never
 * links to `/completed` (that route is M14's completion truth and a concluded
 * run may be incomplete), and it reuses the ONE existing restart leaf, shown
 * only because Slice 10's DTO says the run is restartable.
 */
export function ConcludedRunCallout({
  programSlug,
  completedWorkouts,
  notPerformedWorkouts,
  restartAvailable,
  className,
}: ConcludedRunCalloutProps) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-callout border border-accent-tint-border bg-accent-tint p-4 md:px-5">
        <p className="text-sm font-semibold text-accent-strong">
          Run closed — {completedWorkouts} completed, {notPerformedWorkouts} recorded as not
          performed
        </p>
      </div>

      {restartAvailable && (
        <RestartProgramButton programSlug={programSlug} className="w-full sm:w-auto" />
      )}
    </div>
  );
}
