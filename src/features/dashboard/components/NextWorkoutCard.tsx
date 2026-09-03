import Link from 'next/link';
import { Layers, Timer } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/shared/Badge';
import { cn } from '@/lib/utils';
import type { NextWorkoutView } from '@/features/sessions/next-workout-view';

interface NextWorkoutCardProps {
  readonly view: NextWorkoutView;
  readonly programName: string;
  readonly className?: string;
}

function sessionPath(view: NextWorkoutView): string {
  return `/programs/${view.programSlug}/weeks/${view.weekNumber}/workouts/${view.workoutOrder}/session`;
}

function detailsPath(view: NextWorkoutView): string {
  return `/programs/${view.programSlug}/weeks/${view.weekNumber}/workouts/${view.workoutOrder}`;
}

/**
 * "Up next" card (locked design): accent badge, program/week/workout
 * eyebrow, Sora workout name, exercise + duration meta, exercise preview
 * rows and the Start workout / View details CTAs.
 *
 * The Start CTA targets the session page, whose panels already handle the
 * Start/Resume/Join semantics — the link label reflects the resolved
 * session state so users know what will happen.
 */
export function NextWorkoutCard({ view, programName, className }: NextWorkoutCardProps) {
  const remaining = view.exerciseCount - view.preview.length;
  const startLabel =
    view.sessionState === 'in-progress' ? 'Resume workout' : 'Start workout';

  return (
    <section
      aria-label="Up next"
      className={cn(
        'flex flex-col gap-4 rounded-card border border-border bg-card p-6 md:gap-6 md:p-9',
        className,
      )}
    >
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2.5">
          <Badge variant="accent">UP NEXT</Badge>
          <p className="text-[13px] font-medium text-ink-2 md:text-sm">
            <span className="md:hidden">
              Week {view.weekNumber} · Workout {view.workoutOrder}
            </span>
            <span className="hidden md:inline">
              {programName} · Week {view.weekNumber} · Workout {view.workoutOrder}
            </span>
          </p>
        </div>
        <h2 className="font-display text-2xl font-bold text-foreground md:text-[32px]">
          {view.workoutName}
        </h2>
        <p className="text-sm text-ink-2 md:hidden">
          {view.exerciseCount} {view.exerciseCount === 1 ? 'exercise' : 'exercises'} · about{' '}
          {view.estimatedMinutes} minutes
        </p>
        <div className="hidden items-center gap-5 md:flex">
          <span className="flex items-center gap-2 text-[15px] text-ink-2">
            <Layers aria-hidden="true" className="size-4 text-ink-3" />
            {view.exerciseCount} {view.exerciseCount === 1 ? 'exercise' : 'exercises'}
          </span>
          <span className="flex items-center gap-2 text-[15px] text-ink-2">
            <Timer aria-hidden="true" className="size-4 text-ink-3" />
            About {view.estimatedMinutes} minutes
          </span>
        </div>
      </div>

      {view.preview.length > 0 && (
        <div>
          {view.preview.map((exercise) => (
            <div key={exercise.order} className="border-b border-border last:border-b-0">
              <div className="flex items-center justify-between gap-3 py-2.5 md:py-3">
                <span className="text-sm text-foreground md:text-[15px]">
                  {exercise.exerciseName}
                </span>
                <span className="text-sm font-medium whitespace-nowrap text-ink-2 md:text-[15px]">
                  {exercise.prescriptionLabel}
                </span>
              </div>
            </div>
          ))}
          {remaining > 0 && (
            <p className="pt-2.5 text-[13px] text-ink-3 md:pt-3 md:text-sm">
              + {remaining} more {remaining === 1 ? 'exercise' : 'exercises'}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <Link href={sessionPath(view)} className={buttonVariants({ className: 'w-full md:w-auto' })}>
          {startLabel}
        </Link>
        <Link
          href={detailsPath(view)}
          className={buttonVariants({ variant: 'secondary', className: 'w-full md:w-auto' })}
        >
          View details
        </Link>
      </div>
    </section>
  );
}
