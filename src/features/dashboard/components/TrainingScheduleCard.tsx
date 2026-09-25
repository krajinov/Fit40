import Link from 'next/link';
import { CalendarClock } from 'lucide-react';

import type { DashboardScheduleState } from '@/application/dto/dashboard';
import type { EnrollmentScheduleDto, PlannedWorkoutDto } from '@/application/dto/schedule';
import { Badge } from '@/components/shared/Badge';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatPlannedDateLabel } from '@/features/dashboard/dashboard-labels';
import {
  programPathFromSlug,
  sessionPathFromRoute,
} from '@/features/sessions/session-path';

interface TrainingScheduleCardProps {
  readonly state: DashboardScheduleState;
  readonly programName: string;
  readonly className?: string;
}

function detailsPath(schedule: EnrollmentScheduleDto, workout: PlannedWorkoutDto): string {
  // Authored public coordinates only — never an EnrollmentId or a database id.
  // Mirrors NextWorkoutCard's details link.
  return `/programs/${schedule.programSlug}/weeks/${workout.weekNumber}/workouts/${workout.workoutOrder}`;
}

function sessionPath(schedule: EnrollmentScheduleDto, workout: PlannedWorkoutDto): string {
  return sessionPathFromRoute({
    programSlug: schedule.programSlug,
    weekNumber: workout.weekNumber,
    workoutOrder: workout.workoutOrder,
  });
}

/**
 * M15 training-schedule card (Slice 5): one compact section answering what is
 * planned for today, what comes next, and how far behind the calendar the run
 * is — plus the setup prompt when the run has never been configured.
 *
 * Status and focus come from the application DTO and are never recomputed
 * here. A failed read (`unavailable`) renders nothing: absence of data is not
 * absence of configuration, and this section is additive to the existing
 * dashboard. The session link is the safe existing destination — the session
 * page resolves Start/Resume from its own lookup, so no session id is needed
 * (and none is available on the schedule DTO).
 */
export function TrainingScheduleCard({ state, programName, className }: TrainingScheduleCardProps) {
  if (state.status === 'unavailable') {
    return null;
  }

  const schedule = state.schedule;

  if (!schedule.configured) {
    return (
      <section
        aria-label="Training schedule"
        className={cn(
          'flex flex-col items-start gap-3 rounded-card border border-border bg-card p-6 md:p-9',
          className,
        )}
      >
        <div className="flex flex-col gap-2">
          <h2 className="font-display text-2xl font-bold text-foreground md:text-[30px]">
            Training schedule
          </h2>
          <p className="text-[15px] text-ink-2">
            Choose your training days to put this program on your calendar.
          </p>
        </div>
        <Link
          href={programPathFromSlug(schedule.programSlug)}
          className={buttonVariants({ className: 'w-full md:w-auto' })}
        >
          Set training days
        </Link>
      </section>
    );
  }

  const today = schedule.focus.today;
  const next = schedule.focus.next;
  const pastDue = schedule.focus.pastDue;
  // "Next workout" answers the question only when nothing is actionable today.
  const todayActionable = today !== null && today.status !== 'completed';

  return (
    <section
      aria-label="Training schedule"
      className={cn(
        'flex flex-col gap-5 rounded-card border border-border bg-card p-6 md:gap-6 md:p-9',
        className,
      )}
    >
      <div className="flex flex-col gap-2">
        <h2 className="text-[13px] font-semibold tracking-wide text-ink-3 uppercase md:text-sm">
          Training schedule
        </h2>
        {pastDue !== null && (
          <p className="flex items-center gap-2 text-sm text-ink-2 md:text-[15px]">
            <CalendarClock aria-hidden="true" className="size-4 shrink-0 text-ink-3" />
            {pastDue.count} planned {pastDue.count === 1 ? 'workout' : 'workouts'} behind schedule
          </p>
        )}
      </div>

      {today !== null && (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <Badge variant="accent">TODAY</Badge>
            <p className="text-[13px] font-medium text-ink-2 md:text-sm">
              <span className="md:hidden">
                Week {today.weekNumber} · Workout {today.workoutOrder}
              </span>
              <span className="hidden md:inline">
                {programName} · Week {today.weekNumber} · Workout {today.workoutOrder}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-display text-2xl font-bold text-foreground md:text-[32px]">
              {today.workoutName}
            </h3>
            {today.status === 'completed' && <Badge variant="done">Completed today</Badge>}
            {today.status === 'in-progress' && <Badge variant="neutral">In progress</Badge>}
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            {today.status !== 'completed' && (
              <Link
                href={sessionPath(schedule, today)}
                className={buttonVariants({ className: 'w-full md:w-auto' })}
              >
                {today.status === 'in-progress' ? 'Resume workout' : 'Start workout'}
              </Link>
            )}
            <Link
              href={detailsPath(schedule, today)}
              className={buttonVariants({ variant: 'secondary', className: 'w-full md:w-auto' })}
            >
              View details
            </Link>
          </div>
        </div>
      )}

      {next !== null && !todayActionable && (
        <div className="flex flex-col gap-2.5 border-t border-border pt-5 md:pt-6">
          <div className="flex flex-wrap items-center gap-2.5">
            <Badge variant="neutral">NEXT WORKOUT</Badge>
            <p className="text-[13px] font-medium text-ink-2 md:text-sm">
              <span className="md:hidden">
                Week {next.weekNumber} · Workout {next.workoutOrder}
              </span>
              <span className="hidden md:inline">
                {programName} · Week {next.weekNumber} · Workout {next.workoutOrder}
              </span>
            </p>
          </div>
          <h3 className="font-display text-xl font-bold text-foreground md:text-2xl">
            {next.workoutName}
          </h3>
          <p className="text-sm text-ink-2 md:text-[15px]">
            Planned for {formatPlannedDateLabel(next.plannedDate)}
          </p>
          <div>
            <Link
              href={detailsPath(schedule, next)}
              className={buttonVariants({ variant: 'secondary' })}
            >
              View details
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
