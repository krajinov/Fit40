import Link from 'next/link';

import { Badge } from '@/components/shared/Badge';
import { EmptyState } from '@/components/shared/EmptyState';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ProgramCompletionView } from '@/features/enrollment/completion-view';
import { RestartProgramButton } from '@/features/enrollment/components/RestartProgramButton';

interface ProgramCompletionSummaryProps {
  readonly view: ProgramCompletionView;
}

/**
 * Completed-program summary (M14 Slice 6): renders the completed-run facts
 * from the view model — badge, program identity, workout tally, completion
 * date, distinct exercises, and the run's historical Personal Record events
 * (at most the capped list the application supplied, with the exact count
 * stated truthfully). Composition only — no repositories, no recomputation,
 * no gamification. Rows link to the session that owns the event.
 */
export function ProgramCompletionSummary({ view }: ProgramCompletionSummaryProps) {
  return (
    <div className="flex flex-col gap-8">
      <section
        aria-labelledby="completion-title"
        className="rounded-card border border-border bg-card p-6 md:p-8"
      >
        <Badge variant="done">Program completed</Badge>
        <h1
          id="completion-title"
          className="mt-4 font-display text-2xl font-bold text-foreground md:text-[32px]"
        >
          {view.programName}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-2">
          Every scheduled workout in this program run is complete.
        </p>

        <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-5 border-t border-border pt-6 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold tracking-wide text-ink-2">
              Completed workouts
            </dt>
            <dd className="mt-1 font-display text-xl font-semibold text-foreground">
              {view.workoutTallyLabel}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-wide text-ink-2">Completed on</dt>
            <dd className="mt-1 font-display text-xl font-semibold text-foreground">
              {view.completionDateLabel}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-wide text-ink-2">
              Exercises trained
            </dt>
            <dd className="mt-1 font-display text-xl font-semibold text-foreground">
              {view.distinctExercises}
            </dd>
          </div>
        </dl>
      </section>

      <section
        aria-labelledby="records-title"
        className="rounded-card border border-border bg-card p-6 md:p-8"
      >
        <h2
          id="records-title"
          className="font-display text-lg font-semibold text-foreground md:text-xl"
        >
          Personal records during this program
        </h2>
        <p className="mt-1 text-xs text-ink-2">{view.recordCountCaption}</p>

        {view.recordEvents.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No personal records during this program"
              body="This run completed without any new records."
            />
          </div>
        ) : (
          <>
            <ul className="mt-4 divide-y divide-border">
              {view.recordEvents.map((event) => (
                <li key={event.key}>
                  <Link
                    href={event.sessionHref}
                    className="flex min-h-[44px] items-center justify-between gap-3 py-3 transition-colors hover:bg-accent-tint/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {event.exerciseName}
                      </span>
                      <span className="block text-xs text-ink-2">{event.metricLabel}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-display text-sm font-semibold text-foreground">
                        {event.valueLabel}
                      </span>
                      <span className="block text-xs text-ink-2">{event.completedAtLabel}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {view.recordEventsNote !== null && (
              <p className="mt-3 text-xs text-ink-2">{view.recordEventsNote}</p>
            )}
          </>
        )}
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <RestartProgramButton programSlug={view.programSlug} className="w-full sm:w-auto" />
        <Link
          href={view.catalogHref}
          className={cn(buttonVariants({ variant: 'secondary' }), 'w-full sm:w-auto')}
        >
          Choose another program
        </Link>
      </div>
    </div>
  );
}