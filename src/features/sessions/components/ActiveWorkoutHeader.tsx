import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ScheduledWorkoutDetailDto } from '@/application/dto/program';

interface ActiveWorkoutHeaderProps {
  readonly workout: ScheduledWorkoutDetailDto;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  /**
   * Precomputed eyebrow, e.g. "IN PROGRESS · STARTED 17:42" or
   * "COMPLETED · 18:05" — the caller formats the timestamp.
   */
  readonly eyebrow: string;
}

/**
 * Active Workout header (locked design): accent dot + status eyebrow, Sora
 * title, and — desktop only — the "Workout details" secondary button. Mobile
 * has no header buttons; its finish action lives in the sticky bottom bar.
 */
export function ActiveWorkoutHeader({
  workout,
  programSlug,
  weekNumber,
  workoutOrder,
  eyebrow,
}: ActiveWorkoutHeaderProps) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
      <div className="min-w-0 flex-1 space-y-2">
        <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.6px] text-accent-foreground md:gap-2.5 md:text-[13px] md:tracking-[1px]">
          <span aria-hidden="true" className="size-[7px] shrink-0 rounded-pill bg-primary md:size-2" />
          {eyebrow}
        </p>
        <h1 className="font-display text-[23px] font-bold tracking-tight text-foreground md:text-[34px]">
          {workout.workout.name}
        </h1>
      </div>

      <Link
        href={`/programs/${programSlug}/weeks/${weekNumber}/workouts/${workoutOrder}`}
        className={cn(
          buttonVariants({ variant: 'secondary' }),
          'hidden h-11 shrink-0 md:inline-flex',
        )}
      >
        Workout details
      </Link>
    </div>
  );
}
