import Link from 'next/link';

import type { PlannedWorkoutDto } from '@/application/dto/schedule';
import type { PlannedWorkoutStatus } from '@/domain/services/schedule-focus';
import { Badge } from '@/components/shared/Badge';
import { cn } from '@/lib/utils';
import {
  plannedStatusLabel,
  type WeekDaySlotView,
} from '@/features/schedule/schedule-week-view';
import { MovePlannedWorkoutForm } from '@/features/schedule/components/MovePlannedWorkoutForm';
import { sessionPathFromRoute } from '@/features/sessions/session-path';

interface WeeklyScheduleCalendarProps {
  readonly programSlug: string;
  readonly slots: ReadonlyArray<WeekDaySlotView>;
  readonly className?: string;
}

/** Badge variant per DTO status; the status TEXT is always rendered too. */
const STATUS_VARIANT: Record<PlannedWorkoutStatus, 'neutral' | 'accent' | 'done'> = {
  planned: 'neutral',
  'in-progress': 'accent',
  completed: 'done',
  'past-due': 'neutral',
};

function detailsPath(programSlug: string, item: PlannedWorkoutDto): string {
  // Authored public coordinates only — never an EnrollmentId or database id.
  return `/programs/${programSlug}/weeks/${item.weekNumber}/workouts/${item.workoutOrder}`;
}

/**
 * M15 current-week calendar (Slice 6): seven Monday–Sunday day slots in an
 * ordered list — a vertical stack on mobile and a seven-column grid from `md`
 * up, so narrow screens never scroll horizontally.
 *
 * Every position is truthful DTO state: statuses are labelled with text (never
 * colour alone), today is marked with the words "Today" plus `aria-current`,
 * empty days read "No workout planned" (neutral — never "rest day"), and the
 * single approved in-progress affordance is a read-only link to the existing
 * session route, whose own page resolves Resume. No mutation controls exist
 * here; Slice 7 adds rescheduling.
 */
export function WeeklyScheduleCalendar({
  programSlug,
  slots,
  className,
}: WeeklyScheduleCalendarProps) {
  return (
    <ol
      className={cn('grid grid-cols-1 gap-2 md:grid-cols-7 md:gap-2.5', className)}
      aria-label="This week"
    >
      {slots.map((slot) => (
        <li
          key={slot.date}
          aria-current={slot.isToday ? 'date' : undefined}
          className={cn(
            'flex min-w-0 flex-col gap-1.5 rounded-callout border p-3',
            slot.isToday ? 'border-primary bg-accent-tint' : 'border-border bg-card',
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-x-1.5 gap-y-1">
            <span className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
              {slot.dayLabel}
            </span>
            {slot.isToday && (
              <span className="text-[11px] font-semibold text-accent-strong">Today</span>
            )}
          </div>
          <p className="text-[13px] text-ink-2">{slot.dateLabel}</p>

          {slot.item === null ? (
            <p className="text-[13px] text-ink-3">No workout planned</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Link
                href={detailsPath(programSlug, slot.item)}
                className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
              >
                {slot.item.workoutName}
              </Link>
              <Badge variant={STATUS_VARIANT[slot.item.status]}>
                {plannedStatusLabel(slot.item.status)}
              </Badge>
              <p className="text-[11px] text-ink-3">
                Week {slot.item.weekNumber} · Workout {slot.item.workoutOrder}
              </p>
              {slot.item.status === 'in-progress' && (
                <Link
                  href={sessionPathFromRoute({
                    programSlug,
                    weekNumber: slot.item.weekNumber,
                    workoutOrder: slot.item.workoutOrder,
                  })}
                  className="text-[13px] font-medium text-accent-strong underline-offset-2 hover:underline"
                >
                  Resume
                </Link>
              )}
              {/* Move is offered for NEVER-STARTED workouts only: `planned`
                  and `past-due` (the approved plan names manual rescheduling
                  as a past-due remedy, and the use case accepts any target
                  today-or-later). Completed and in-progress cells stay
                  read-only — the use case rejects those moves authoritatively. */}
              {(slot.item.status === 'planned' || slot.item.status === 'past-due') && (
                <MovePlannedWorkoutForm
                  programSlug={programSlug}
                  weekNumber={slot.item.weekNumber}
                  workoutOrder={slot.item.workoutOrder}
                  plannedDate={slot.item.plannedDate}
                  workoutName={slot.item.workoutName}
                />
              )}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}