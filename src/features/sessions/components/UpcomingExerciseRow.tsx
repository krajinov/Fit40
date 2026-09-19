import { ChevronDown } from 'lucide-react';
import type { SyntheticEvent } from 'react';

import type { WorkoutSessionExerciseDto } from '@/application/dto/workout-session';
import type { SessionExerciseCardView } from '@/features/sessions/active-workout-views';
import { cn } from '@/lib/utils';
import { SetLoggerForm } from '@/features/sessions/components/SetLoggerForm';
import type { SetLoggerDraft } from '@/features/sessions/set-logger-draft';
import { SessionExerciseSwapPanel } from '@/features/sessions/components/SessionExerciseSwapPanel';
import { SessionExerciseAdjustPanel } from '@/features/sessions/components/SessionExerciseAdjustPanel';

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
 * Title area of one upcoming row: the performed exercise as the primary
 * name, with the same subtle "Originally: …" context used elsewhere when the
 * occurrence is substituted (the view mapper already resolved the authored
 * name; null renders no line).
 */
function UpcomingExerciseTitle({ exercise }: { readonly exercise: SessionExerciseCardView }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-semibold text-ink-2 md:text-base">
        {exercise.name}
      </span>
      {exercise.originallyName !== null && (
        <span className="block truncate text-[11px] text-ink-3 md:text-xs">
          Originally: {exercise.originallyName}
        </span>
      )}
    </span>
  );
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
 * (the standalone grouped-list composition and its unit tests).
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
  const logger = exercise.logger;
  if (log === undefined || logger === null) {
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

  function handleToggle(event: SyntheticEvent<HTMLDetailsElement>): void {
    onDetailsOpenChange?.(event.currentTarget.open);
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
        <div className="pb-3 pt-1">
          <SetLoggerForm
            key={`${exercise.renderKey}-${exercise.setRows.length}-${logger.prefillWeightKg ?? logger.prefillSeconds ?? 'none'}`}
            sessionId={sessionId}
            exerciseOrder={log.order}
            expectedSessionVersion={expectedSessionVersion}
            prescription={log.prescription}
            programSlug={programSlug}
            weekNumber={weekNumber}
            workoutOrder={workoutOrder}
            prefillWeightKg={logger.prefillWeightKg}
            prefillSeconds={logger.prefillSeconds}
            callout={logger.callout}
            quietLabel={logger.quietLabel}
            hintLabel={logger.hintLabel}
            draft={draft}
            onDraftChange={onDraftChange}
          />
          <UpcomingExerciseExpandedPanels
            exercise={exercise}
            log={log}
            sessionId={sessionId}
            expectedSessionVersion={expectedSessionVersion}
            programSlug={programSlug}
            weekNumber={weekNumber}
            workoutOrder={workoutOrder}
          />
        </div>
      </details>
    </li>
  );
}

interface UpcomingExerciseExpandedPanelsProps {
  readonly exercise: SessionExerciseCardView;
  readonly log: WorkoutSessionExerciseDto;
  readonly sessionId: string;
  readonly expectedSessionVersion: number;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

/**
 * The swap + skip/move affordances inside an upcoming row's expand. Both
 * consume the pure view-mapper state verbatim (no substitution or movement
 * rule lives here), mirroring the main card.
 */
function UpcomingExerciseExpandedPanels({
  exercise,
  log,
  sessionId,
  expectedSessionVersion,
  programSlug,
  weekNumber,
  workoutOrder,
}: UpcomingExerciseExpandedPanelsProps) {
  const showsSwap =
    exercise.substitution.state === 'replace' ||
    exercise.substitution.state === 'restore-available' ||
    exercise.substitution.state === 'no-candidates';

  return (
    <>
      {showsSwap && (
        <div className="pt-3">
          <SessionExerciseSwapPanel
            sessionId={sessionId}
            exerciseOrder={log.order}
            expectedSessionVersion={expectedSessionVersion}
            programSlug={programSlug}
            weekNumber={weekNumber}
            workoutOrder={workoutOrder}
            substitution={exercise.substitution}
          />
        </div>
      )}
      {exercise.adjustment.state !== 'hidden' && (
        <SessionExerciseAdjustPanel
          sessionId={sessionId}
          exerciseOrder={log.order}
          expectedSessionVersion={expectedSessionVersion}
          programSlug={programSlug}
          weekNumber={weekNumber}
          workoutOrder={workoutOrder}
          adjustment={exercise.adjustment}
        />
      )}
    </>
  );
}