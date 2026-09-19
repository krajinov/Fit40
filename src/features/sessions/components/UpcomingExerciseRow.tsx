import type { SyntheticEvent } from 'react';
import { ChevronDown } from 'lucide-react';

import type { WorkoutSessionExerciseDto } from '@/application/dto/workout-session';
import type { SessionExerciseCardView } from '@/features/sessions/active-workout-views';
import { cn } from '@/lib/utils';
import type { SetLoggerDraft } from '@/features/sessions/set-logger-draft';
import { UpcomingExerciseExpandedPanels } from '@/features/sessions/components/UpcomingExerciseExpandedPanels';
import { UpcomingExerciseTitle } from '@/features/sessions/components/UpcomingExerciseTitle';

interface UpcomingExerciseRowProps {
  readonly exercise: SessionExerciseCardView;
  /** Absent when the session carries no log for this order (renders the plain row). */
  readonly log: WorkoutSessionExerciseDto | undefined;
  readonly sessionId: string;
  readonly expectedSessionVersion: number;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  /** Controlled logger draft owned by the occurrence boundary (PR #13 P2). */
  readonly draft?: SetLoggerDraft;
  readonly onDraftChange?: (draft: SetLoggerDraft) => void;
  /**
   * Controlled disclosure state owned by the occurrence boundary: the open
   * state then follows the occurrence across a representation change.
   */
  readonly detailsOpen?: boolean;
  readonly onDetailsOpenChange?: (open: boolean) => void;
  /** Extra classes for the row shell (the unified occurrence list adds its grouping). */
  readonly className?: string;
  /** Presentation band marker (the unified list stamps the compact band). */
  readonly band?: 'upcoming';
}

/**
 * One compact "Up next" row (locked design): dimmed identity row (surface-2
 * order circle, ink-2 name, ink-3 prescription) with a subtle expand that
 * reveals the same set logger the main card uses.
 *
 * The row is the KEYED OCCURRENCE BOUNDARY's compact representation (PR #13
 * P2): the occurrence boundary owns the draft/disclosure state and passes it
 * here, so a draft survives when a reorder moves the occurrence between this
 * compact row and the full `SessionExerciseCard` — React no longer reparents
 * the subtree. The row keeps its own state when no controlled props are given
 * (the standalone grouped-list composition and its unit tests). Composition
 * only: the identity title and the expanded logger/swap/adjust content live
 * in their own focused modules.
 */
export function UpcomingExerciseRow({
  exercise,
  log,
  sessionId,
  expectedSessionVersion,
  programSlug,
  weekNumber,
  workoutOrder,
  draft,
  onDraftChange,
  detailsOpen,
  onDetailsOpenChange,
  className,
  band,
}: UpcomingExerciseRowProps) {
  function handleToggle(event: SyntheticEvent<HTMLDetailsElement>): void {
    onDetailsOpenChange?.(event.currentTarget.open);
  }

  if (log === undefined || exercise.logger === null) {
    return (
      <li
        data-band={band}
        className={cn('flex items-center gap-2.5 py-3 md:gap-3.5 md:py-4', className)}
      >
        <span
          aria-hidden="true"
          className="flex size-[26px] shrink-0 items-center justify-center rounded-pill bg-surface-2 text-xs font-semibold text-ink-3 md:size-[34px] md:text-sm"
        >
          {exercise.order}
        </span>
        <UpcomingExerciseTitle exercise={exercise} />
        <span className="shrink-0 text-xs text-ink-3 md:text-[13px]">
          {exercise.prescriptionLabel}
        </span>
      </li>
    );
  }

  return (
    <li data-band={band} className={cn('py-1.5 md:py-2', className)}>
      <details
        className="group/up"
        open={detailsOpen}
        onToggle={detailsOpen === undefined ? undefined : handleToggle}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-lg py-1.5 transition-colors hover:bg-surface-2/60 md:gap-3.5 [&::-webkit-details-marker]:hidden">
          <span
            aria-hidden="true"
            className="flex size-[26px] shrink-0 items-center justify-center rounded-pill bg-surface-2 text-xs font-semibold text-ink-3 md:size-[34px] md:text-sm"
          >
            {exercise.order}
          </span>
          <UpcomingExerciseTitle exercise={exercise} />
          <span className="shrink-0 text-xs text-ink-3 md:text-[13px]">
            {exercise.prescriptionLabel}
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-ink-3 transition-transform group-open/up:rotate-180"
          />
        </summary>
        <UpcomingExerciseExpandedPanels
          exercise={exercise}
          log={log}
          sessionId={sessionId}
          expectedSessionVersion={expectedSessionVersion}
          programSlug={programSlug}
          weekNumber={weekNumber}
          workoutOrder={workoutOrder}
          draft={draft}
          onDraftChange={onDraftChange}
        />
      </details>
    </li>
  );
}