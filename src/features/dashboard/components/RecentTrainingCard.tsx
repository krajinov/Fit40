import Link from 'next/link';
import { Dumbbell } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { RecentTrainingState } from '@/features/dashboard/dashboard-view';

interface RecentTrainingCardProps {
  readonly recentTraining: RecentTrainingState;
  readonly className?: string;
}

/**
 * "Recent training" card: the user's latest completed sessions from the
 * user-global Training History read model — the same source of truth as
 * /history — so sessions from previous or detached enrollments appear too.
 *
 * Each row is one block link to the completed-session detail page (a single
 * large touch target, no nested interactive elements). The "View all
 * training history" link is always rendered: with the bottom tab bar fixed
 * at four items, this card is the dashboard's entry point to History on
 * mobile. A failed history read renders its own truthful state — never the
 * empty state, which would claim the user has no training.
 */
export function RecentTrainingCard({ recentTraining, className }: RecentTrainingCardProps) {
  return (
    <section
      aria-label="Recent training"
      className={cn('flex flex-col gap-4 rounded-card border border-border bg-card p-8', className)}
    >
      <h2 className="font-display text-xl font-semibold text-foreground">Recent training</h2>

      {recentTraining.status === 'unavailable' ? (
        <p className="text-sm text-ink-2">Couldn&apos;t load recent training.</p>
      ) : recentTraining.sessions.length === 0 ? (
        <p className="text-sm text-ink-2">Completed workouts will appear here.</p>
      ) : (
        <ol className="flex flex-col">
          {recentTraining.sessions.map((session) => (
            <li
              key={session.sessionId}
              className="border-b border-border first:pt-0 last:border-b-0 last:pb-0"
            >
              <Link
                href={`/history/sessions/${session.sessionId}`}
                className="group flex items-center gap-4 rounded-control py-4 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-control bg-accent-tint"
                >
                  <Dumbbell className="size-[18px] text-accent-strong" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[15px] font-medium text-foreground group-hover:underline">
                    {session.workoutName}
                  </span>
                  <span className="truncate text-sm text-ink-2">
                    {session.programName} · {session.setsLabel}
                  </span>
                </span>
                <span className="shrink-0 text-sm text-ink-2">{session.completedAtLabel}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}

      <Link
        href="/history"
        className="self-start rounded-control text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        View all training history
      </Link>
    </section>
  );
}
