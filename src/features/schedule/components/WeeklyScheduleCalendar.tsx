import Link from 'next/link';

import type { PlannedWorkoutDto } from '@/application/dto/schedule';
import type { PlannedWorkoutStatus } from '@/domain/services/schedule-focus';
import { Badge } from '@/components/shared/Badge';
import { cn } from '@/lib/utils';
import {
  plannedStatusLabel,
  type WeekDaySlotView,
} from '@/features/schedule/schedule-week-view';
import { ScheduleSlotControls } from '@/features/schedule/components/ScheduleSlotControls';
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
  'not-performed': 'neutral',
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
 * in-progress affordance stays a read-only link to the existing session route,
 * whose own page resolves Resume. M15 Slice 7 added Move; M17 Slice 11 adds the
 * record/undo settlement controls — all of them keyed by the DTO's resolved
 * status (see `ScheduleSlotControls`), so this component still derives nothing.
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
              {/* Settlement and Move affordances, keyed by the DTO status the
                  application already resolved: Move stays limited to
                  NEVER-STARTED workouts, `Didn't train this` is offered wherever
                  the use case may accept a record, a recorded slot offers Undo
                  only, and a completed slot offers none of them. */}
              <ScheduleSlotControls programSlug={programSlug} item={slot.item} />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}