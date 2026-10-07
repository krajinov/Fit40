import Link from 'next/link';

import { Badge } from '@/components/shared/Badge';
import { ProgressBar } from '@/components/shared/ProgressBar';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DIFFICULTY_LABELS } from '@/features/exercises/exercise-labels';
import { PROGRAM_GOAL_LABELS } from '@/features/programs/program-labels';
import type { DashboardProgramView } from '@/features/dashboard/dashboard-view';

interface CurrentProgramCardProps {
  readonly view: DashboardProgramView;
  readonly className?: string;
}

/**
 * "Current program" side card (locked design): eyebrow, program name,
 * difficulty/goal badges, week and workout counts, progress bar and the
 * View program link.
 */
export function CurrentProgramCard({ view, className }: CurrentProgramCardProps) {
  const { program, enrollment, currentWeek } = view;
  const progress = enrollment.progress;
  // The AUTHORITATIVE current week resolved once by the view assembly from the
  // same open occurrence Up next uses. This card must never derive it from the
  // completion-only `enrollment.nextWorkout`, which can point at a week already
  // settled as recorded not performed (and would then contradict Up next).
  //
  // A null week means the run has NO open occurrence — a concluded run (or the
  // degraded failed-read case) — so the heading falls back to the authored
  // duration exactly as a completed run's did, never to an old recorded week.
  const currentWeekNumber = currentWeek?.weekNumber ?? program.durationWeeks;

  return (
    <section
      aria-label="Current program"
      className={cn('flex flex-col gap-5 rounded-card border border-border bg-card p-7', className)}
    >
      <p className="text-xs font-semibold tracking-wide text-accent-foreground">CURRENT PROGRAM</p>

      <div className="flex flex-col gap-2.5">
        <h2 className="font-display text-[22px] font-bold text-foreground">{program.name}</h2>
        <div className="flex flex-wrap gap-2">
          <Badge>{DIFFICULTY_LABELS[program.difficulty]}</Badge>
          <Badge>{PROGRAM_GOAL_LABELS[program.goal]}</Badge>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[15px] font-semibold text-foreground">
            Week {currentWeekNumber} of {program.durationWeeks}
          </p>
          <p className="text-sm text-ink-2">
            {progress.completedWorkouts} of {progress.totalWorkouts} workouts
          </p>
        </div>
        <ProgressBar value={progress.percentage} label="Program progress" />
      </div>

      <Link
        href={`/programs/${program.slug}`}
        className={cn(buttonVariants({ variant: 'secondary' }), 'w-full')}
      >
        View program
      </Link>
    </section>
  );
}
