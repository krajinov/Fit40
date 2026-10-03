import Link from 'next/link';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ProgramScheduledWorkoutDto } from '@/application/dto/program';
import { UndoNotPerformedForm } from '@/features/schedule/components/UndoNotPerformedForm';

export type ScheduledWorkoutState = 'completed' | 'up-next' | 'scheduled';

interface ScheduledWorkoutCardProps {
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly scheduled: ProgramScheduledWorkoutDto;
  readonly state: ScheduledWorkoutState;
  /**
   * The occurrence is settled as recorded-not-performed — the M15 read's own
   * status, passed through by the week section (M17 Slice 11). Presentation
   * never infers it from a missing session: when true the card states the
   * stored fact, is never "up next", and exposes `Undo` alone (no Start, no
   * Move).
   */
  readonly recorded?: boolean;
}

function workoutPath(
  programSlug: string,
  weekNumber: number,
  order: number,
): string {
  return `/programs/${programSlug}/weeks/${weekNumber}/workouts/${order}`;
}

/**
 * One scheduled workout inside a week card (locked design).
 *
 * - completed: accent circle with a check, "Completed" caption
 * - up next:   accent-tint card with accent border, "Up next" caption
 * - scheduled: bordered circle with the order number, "Scheduled" caption
 *
 * Every occurrence stays a working link to its workout detail page — the
 * domain enforces no week locking, so no state renders disabled or fake-
 * locked (the locked design's "unlocks after Week N" treatment is omitted).
 */
export function ScheduledWorkoutCard({
  programSlug,
  weekNumber,
  scheduled,
  state,
  recorded = false,
}: ScheduledWorkoutCardProps) {
  const caption = recorded
    ? 'Recorded as not performed'
    : state === 'completed'
      ? 'Completed'
      : state === 'up-next'
        ? 'Up next'
        : 'Scheduled';

  const body = (
    <>
      <div className="flex items-center gap-2.5">
        {state === 'completed' ? (
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-pill bg-primary"
          >
            <Check className="size-3.5 text-primary-foreground" />
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-pill border border-border-strong bg-card text-[13px] font-semibold text-ink-2"
          >
            {scheduled.order}
          </span>
        )}
        <span className="text-[13px] text-ink-3">{scheduled.estimatedDurationMinutes} min</span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[15px] font-semibold text-foreground">
          {scheduled.workoutName}
        </span>
        <span
          className={cn(
            'text-[13px]',
            state === 'up-next' && !recorded ? 'font-semibold text-accent-strong' : 'text-ink-3',
          )}
        >
          {caption}
        </span>
      </div>
    </>
  );

  // A recorded occurrence keeps its detail link but carries a control, and a
  // control may not live inside an anchor — so the card becomes a container
  // with a link and the Undo form side by side.
  if (recorded) {
    return (
      <div className="flex flex-col gap-3 rounded-callout border border-border bg-background p-4">
        <Link
          href={workoutPath(programSlug, weekNumber, scheduled.order)}
          className="flex flex-col gap-2.5 rounded-[10px] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {body}
        </Link>
        <UndoNotPerformedForm
          programSlug={programSlug}
          weekNumber={weekNumber}
          workoutOrder={scheduled.order}
        />
      </div>
    );
  }

  return (
    <Link
      href={workoutPath(programSlug, weekNumber, scheduled.order)}
      className={cn(
        'flex flex-col gap-2.5 rounded-callout border p-4 transition-colors',
        'hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        state === 'up-next'
          ? 'border-primary bg-accent-tint'
          : 'border-border bg-background',
      )}
      aria-current={state === 'up-next' ? 'true' : undefined}
    >
      {body}
    </Link>
  );
}
