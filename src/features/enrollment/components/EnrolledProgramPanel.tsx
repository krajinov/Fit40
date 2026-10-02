import Link from 'next/link';
import { Check } from 'lucide-react';

import { ProgressBar } from '@/components/shared/ProgressBar';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ProgramEnrollmentViewDto } from '@/application/dto/enrollment';
import type { RunClosureSummaryDto } from '@/application/dto/run-closure';
import { ConcludedRunCallout } from '@/features/enrollment/components/ConcludedRunCallout';
import { LeaveProgramButton } from '@/features/enrollment/components/LeaveProgramButton';
import { RestartProgramButton } from '@/features/enrollment/components/RestartProgramButton';
import { resolveEnrolledPanelState } from '@/features/enrollment/program-panel-state';

interface EnrolledProgramPanelProps {
  readonly program: {
    readonly slug: string;
    readonly name: string;
    readonly durationWeeks: number;
  };
  readonly enrollment: Extract<ProgramEnrollmentViewDto, { status: 'enrolled' }>;
  /**
   * The enrollment's next workout (name, meta, session state), 'unavailable'
   * when its preview could not be resolved (a degraded state — the program
   * is NOT complete), or null when every workout is completed.
   */
  readonly nextWorkout:
    | {
        readonly weekNumber: number;
        readonly workoutOrder: number;
        readonly workoutName: string;
        readonly metaLabel: string;
        readonly sessionState: 'not-started' | 'in-progress';
      }
    | 'unavailable'
    | null;
  /**
   * Slice 10's closure summary (M17 Slice 11): the panel distinguishes
   * complete / concluded-but-incomplete / open from its verdicts. Null means
   * the read was unavailable, in which case the panel keeps its pre-M17
   * keying and shows no closure counts.
   */
  readonly runClosure: RunClosureSummaryDto | null;
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
  runClosure,
  className,
}: EnrolledProgramPanelProps) {
  const progress = enrollment.progress;
  const panelState = resolveEnrolledPanelState({
    nextWorkout,
    runClosure,
    enrollmentNextWorkout: enrollment.nextWorkout,
    durationWeeks: program.durationWeeks,
  });
  // The panel view model owns the current-week authority. It follows the run's
  // AUTHORITATIVE first open occurrence when the closure read supplied it, keeps
  // the last-week presentation for a complete run, is null for a concluded-but-
  // incomplete run (no open week exists), and preserves the M14 fallback
  // verbatim when the closure read failed — so a week holding only a recorded
  // occurrence is never claimed as the week the user is on.
  const currentWeekNumber = panelState.currentWeekNumber;
  const startLabel =
    nextWorkout !== null &&
    nextWorkout !== 'unavailable' &&
    nextWorkout.sessionState === 'in-progress'
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
          {currentWeekNumber === null
            ? 'YOUR ENROLLMENT'
            : `YOUR ENROLLMENT · WEEK ${currentWeekNumber} OF ${program.durationWeeks}`}
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
              {currentWeekNumber === null
                ? `${progress.completedWorkouts} of ${progress.totalWorkouts} workouts completed`
                : `Week ${currentWeekNumber} of ${program.durationWeeks} · ${progress.completedWorkouts} of ${progress.totalWorkouts} workouts completed`}
            </h2>
          </div>
          <LeaveProgramButton programSlug={program.slug} />
        </div>

        <ProgressBar value={progress.percentage} label="Program progress" />
      </div>

      {/* M17 Slice 11: three mutually exclusive lifecycle states, chosen from
          Slice 10's DTO verdicts (never recomputed here). A concluded-but-
          incomplete run is stated as counts and never gets completion copy or
          the /completed link; a completed run keeps M14's completion surface;
          an open run shows its remaining work and never offers restart. */}
      {panelState.kind === 'concluded' ? (
        <ConcludedRunCallout
          programSlug={program.slug}
          completedWorkouts={panelState.completedWorkouts}
          notPerformedWorkouts={panelState.notPerformedWorkouts}
          restartAvailable={panelState.restartAvailable}
        />
      ) : typeof nextWorkout === 'string' ? (
        <div className="flex flex-col gap-1.5 rounded-callout border border-accent-tint-border bg-accent-tint p-4 md:px-5">
          <p className="text-sm font-semibold text-accent-strong">
            Next workout unavailable
          </p>
          <p className="text-[13px] text-ink-2">
            We couldn&apos;t load the next workout right now.
          </p>
        </div>
      ) : panelState.kind === 'complete' ? (
        <div className="flex flex-col gap-3">
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
          {/* M14 (Slice 7): completion surfacing for the COMPLETE enrollment
              only — summary link plus the shared Slice 6 restart leaf, shown
              when the closure DTO says the run may restart. Incomplete and
              concluded enrollments never reach this branch. */}
          {panelState.restartAvailable && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href={`/programs/${program.slug}/completed`}
                className={cn(buttonVariants({ variant: 'secondary' }), 'w-full sm:w-auto')}
              >
                View completion summary
              </Link>
              <RestartProgramButton programSlug={program.slug} className="w-full sm:w-auto" />
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {nextWorkout !== null && (
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
          )}
          {/* Factual remaining work from the closure DTO (counts only — no
              percentage, no judgment, no restart). Shown only when the read
              supplied it, so a degraded read invents nothing. */}
          {panelState.openWorkouts !== null && panelState.totalWorkouts !== null && (
            <p className="text-[13px] text-ink-2">
              {panelState.openWorkouts} of {panelState.totalWorkouts} workouts still open
            </p>
          )}
        </div>
      )}

      {/* Mobile keeps Leave reachable (the locked mobile design omits it,
          but removing the only destructive control would hide a working
          behavior). */}
      <LeaveProgramButton programSlug={program.slug} className="md:hidden" />
    </section>
  );
}
