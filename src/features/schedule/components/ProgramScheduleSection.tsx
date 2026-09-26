import { CalendarClock } from 'lucide-react';

import type { ScheduleReadState } from '@/application/dto/schedule';
import { cn } from '@/lib/utils';
import { formatPlannedDateLabel } from '@/lib/dates';
import { buildWeekSlots } from '@/features/schedule/schedule-week-view';
import { WeeklyScheduleCalendar } from '@/features/schedule/components/WeeklyScheduleCalendar';

interface ProgramScheduleSectionProps {
  readonly schedule: ScheduleReadState;
  readonly className?: string;
}

/**
 * Anchor target for the Slice 7 training-days form (and for the dashboard's
 * "Set training days" deep link onto this page). Slice 6 renders the read-only
 * setup state itself — no form, no button, nothing that appears to save.
 */
export const TRAINING_SCHEDULE_SECTION_ID = 'training-schedule';

/**
 * M15 training-schedule section of the program detail (Slice 6), read-only.
 *
 * Three truthful states: a failed read renders nothing (absence of data is not
 * absence of configuration — and scheduling is additive, so failure degrades
 * only this section); `configured: false` renders the setup copy with the one
 * approved UTC helper line; a configured run renders the past-due summary, the
 * seven-day Monday–Sunday calendar and the one approved weekly caption.
 * Completed runs never reach this section — the page suppresses it so the M14
 * completion surface stays authoritative.
 */
export function ProgramScheduleSection({ schedule, className }: ProgramScheduleSectionProps) {
  if (schedule.status === 'unavailable') {
    return null;
  }

  const dto = schedule.schedule;

  if (!dto.configured) {
    return (
      <section
        id={TRAINING_SCHEDULE_SECTION_ID}
        aria-label="Training schedule"
        className={cn(
          'flex flex-col items-start gap-3 rounded-card border border-border bg-card p-5 md:p-8',
          className,
        )}
      >
        <div className="flex flex-col gap-2">
          <h2 className="font-display text-[22px] font-bold tracking-tight text-foreground md:text-2xl">
            Training schedule
          </h2>
          <p className="text-[15px] text-ink-2">
            Choose your training days to put this program on your calendar.
          </p>
          <p className="text-sm font-medium text-foreground">No training days set yet.</p>
          {/* Approved M15 setup disclosure (1 of 2 UTC lines in this UI). */}
          <p className="text-[13px] text-ink-3">
            Weeks run Monday&ndash;Sunday on the app&apos;s UTC calendar &mdash; the same
            calendar your weekly insights use.
          </p>
        </div>
      </section>
    );
  }

  const slots = buildWeekSlots(dto);
  if (slots === null) {
    // Corrupt schedule data: degrade this section only, invent nothing.
    return null;
  }

  const pastDue = dto.focus.pastDue;

  return (
    <section
      id={TRAINING_SCHEDULE_SECTION_ID}
      aria-label="Training schedule"
      className={cn(
        'flex flex-col gap-4 rounded-card border border-border bg-card p-5 md:gap-5 md:p-8',
        className,
      )}
    >
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-[22px] font-bold tracking-tight text-foreground md:text-2xl">
          Training schedule
        </h2>
        {pastDue !== null && (
          <div className="flex flex-col gap-0.5" data-testid="schedule-past-due">
            <p className="flex items-center gap-2 text-sm text-ink-2 md:text-[15px]">
              <CalendarClock aria-hidden="true" className="size-4 shrink-0 text-ink-3" />
              {pastDue.count} planned {pastDue.count === 1 ? 'workout' : 'workouts'} behind
              schedule
            </p>
            <p className="text-[13px] text-ink-3">
              Earliest: {pastDue.earliest.workoutName} ·{' '}
              {formatPlannedDateLabel(pastDue.earliest.plannedDate)}
            </p>
          </div>
        )}
      </div>

      <WeeklyScheduleCalendar programSlug={dto.programSlug} slots={slots} />

      {/* Approved M15 weekly caption (2 of 2 UTC lines in this UI). */}
      <p className="text-xs text-ink-3">Weeks run Monday&ndash;Sunday (UTC).</p>
    </section>
  );
}