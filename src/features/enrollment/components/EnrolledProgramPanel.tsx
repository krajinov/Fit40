import Link from 'next/link';
import { Check } from 'lucide-react';

import { ProgressBar } from '@/components/shared/ProgressBar';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ProgramEnrollmentViewDto } from '@/application/dto/enrollment';
import { LeaveProgramButton } from '@/features/enrollment/components/LeaveProgramButton';

interface EnrolledProgramPanelProps {
  readonly program: {
    readonly slug: string;
    readonly name: string;
    readonly durationWeeks: number;
  };
  readonly enrollment: Extract<ProgramEnrollmentViewDto, { status: 'enrolled' }>;
  /**
   * Presentation view of the enrollment's next workout (name, meta,
   * session state), or null when every workout is completed.
   */
  readonly nextWorkout: {
    readonly weekNumber: number;
    readonly workoutOrder: number;
    readonly workoutName: string;
    readonly metaLabel: string;
    readonly sessionState: 'not-started' | 'in-progress';
  } | null;
  readonly className?: string;
}

/**
 * Enrollment area of the program detail page for signed-in enrolled users
 * (locked design): "Your enrollment" card with progress, the highlighted
 * Up next row with its Start/Resume CTA (targeting the session page, whose
 * panels own the start/resume semantics), and the Leave control with its
 * inline two-step confirmation.
 */
export function EnrolledProgramPanel({
  program,
  enrollment,
  nextWorkout,
  className,
}: EnrolledProgramPanelProps) {
  const progress = enrollment.progress;
  const currentWeekNumber =
    nextWorkout === null ? program.durationWeeks : nextWorkout.weekNumber;
  const startLabel =
    nextWorkout !== null && nextWorkout.sessionState === 'in-progress'
      ? 'Resume workout'
      : 'Start workout';

  return (
    <section
      aria-label="Your enrollment"
      className={cn(
        'flex flex-col gap-4 rounded-card border border-border bg-card p-5 md:gap-5 md:p-8',
        className,
      )}
    >
      {/* Mobile: eyebrow + track + count (locked mobile design). */}
      <div className="flex flex-col gap-3.5 md:hidden">
        <p className="text-[11px] font-semibold tracking-wide text-accent-foreground">
          YOUR ENROLLMENT · WEEK {currentWeekNumber} OF {program.durationWeeks}
        </p>
        <ProgressBar
          value={progress.percentage}
          label="Program progress"
          thin
        />
        <p className="text-[13px] text-ink-2">
          {progress.completedWorkouts} of {progress.totalWorkouts} workouts completed
        </p>
      </div>

      {/* Desktop: eyebrow + title, track, up-next row, actions. */}
      <div className="hidden flex-col gap-5 md:flex">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold tracking-wide text-accent-foreground">
              YOUR ENROLLMENT
            </p>
            <h2 className="font-display text-xl font-semibold text-foreground">
              Week {currentWeekNumber} of {program.durationWeeks} ·{' '}
              {progress.completedWorkouts} of {progress.totalWorkouts} workouts completed
            </h2>
          </div>
          <LeaveProgramButton programSlug={program.slug} />
        </div>

        <ProgressBar value={progress.percentage} label="Program progress" />
      </div>

      {nextWorkout !== null ? (
        <div className="flex flex-col gap-3.5 rounded-callout border-[1.5px] border-primary bg-accent-tint p-4 md:flex-row md:items-center md:justify-between md:gap-5 md:px-5 md:py-[18px]">
          <div className="flex flex-col gap-1">
            <p className="text-[11px] font-semibold tracking-wide text-accent-foreground md:text-xs">
              UP NEXT · WEEK {nextWorkout.weekNumber} · WORKOUT {nextWorkout.workoutOrder}
            </p>
            <p className="font-display text-lg font-bold text-foreground md:text-xl">
              {nextWorkout.workoutName}
            </p>
            <p className="text-[13px] text-ink-2 md:text-sm">{nextWorkout.metaLabel}</p>
          </div>
          <Link
            href={`/programs/${program.slug}/weeks/${nextWorkout.weekNumber}/workouts/${nextWorkout.workoutOrder}/session`}
            className={cn(buttonVariants(), 'w-full md:w-auto')}
          >
            {startLabel}
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-callout border border-accent-tint-border bg-accent-tint p-4 md:px-5">
          <p className="text-sm font-semibold text-accent-strong">
            Program completed — every workout is done.
          </p>
          <span
            className="inline-flex h-7 items-center rounded-pill bg-accent-tint px-3 text-[13px] font-semibold text-accent-strong"
          >
            <Check aria-hidden="true" className="mr-1.5 size-3.5" />
            Completed
          </span>
        </div>
      )}

      {/* Mobile keeps Leave reachable (the locked mobile design omits it,
          but removing the only destructive control would hide a working
          behavior). */}
      <LeaveProgramButton programSlug={program.slug} className="md:hidden" />
    </section>
  );
}
