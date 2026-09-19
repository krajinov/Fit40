'use client';

import { useState } from 'react';

import type { WorkoutSessionExerciseDto } from '@/application/dto/workout-session';
import type { SessionExerciseCardView } from '@/features/sessions/active-workout-views';
import {
  setLoggerDraftFromPrefill,
  type SetLoggerDraft,
} from '@/features/sessions/set-logger-draft';
import { SessionExerciseCard } from '@/features/sessions/components/SessionExerciseCard';
import { UpcomingExerciseRow } from '@/features/sessions/components/UpcomingExerciseRow';

/** Which visual representation this occurrence currently renders. */
export type SessionOccurrenceRepresentation = 'card' | 'upcoming';

/** Position inside the presentational "Up next" group (drives merged chrome). */
export type UpcomingGroupPosition = 'only' | 'first' | 'middle' | 'last';

interface SessionOccurrenceProps {
  readonly card: SessionExerciseCardView;
  readonly log: WorkoutSessionExerciseDto;
  readonly representation: SessionOccurrenceRepresentation;
  /** Null in the full-card representation; the group position otherwise. */
  readonly upcomingPosition: UpcomingGroupPosition | null;
  readonly sessionId: string;
  readonly expectedSessionVersion: number;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

/**
 * The occurrence's logger instance key: it changes exactly when the resolved
 * session data changes (a logged set, a new prefill), so the boundary resets
 * the draft then — and keeps it on a pure reorder/band change.
 */
function loggerInstanceKey(card: SessionExerciseCardView): string {
  return `${card.renderKey}-${card.setRows.length}-${card.logger?.prefillWeightKg ?? card.logger?.prefillSeconds ?? 'none'}`;
}

/** The initial draft from the occurrence's resolved prefill. */
function draftFromCard(card: SessionExerciseCardView): SetLoggerDraft {
  return setLoggerDraftFromPrefill(
    card.logger?.prefillWeightKg ?? null,
    card.logger?.prefillSeconds ?? null,
  );
}

/**
 * The group chrome that makes the compact rows read as ONE "Up next" surface
 * even though they are siblings in the unified occurrence list — pure
 * presentation, never an ownership parent for occurrence-local state.
 */
function upcomingGroupClassName(position: UpcomingGroupPosition | null): string {
  switch (position) {
    case 'only':
      return 'bg-card border border-border rounded-card px-4 md:px-6';
    case 'first':
      return 'bg-card border-x border-t border-border rounded-t-card px-4 md:px-6';
    case 'middle':
      return 'bg-card border-x border-t border-border px-4 md:px-6 -mt-4 md:-mt-6';
    case 'last':
      return 'bg-card border-x border-t border-border rounded-b-card px-4 md:px-6 -mt-4 md:-mt-6';
    default:
      return '';
  }
}

/**
 * ONE keyed occurrence boundary for the Active Workout screen (PR #13 P2).
 *
 * React matches keys only among the children of a single parent, so a stable
 * `renderKey` alone could not keep an occurrence's local state when a reorder
 * moved it between the full-card band and the quiet "Up next" band: the
 * subtree was unmounted/remounted and the logger draft/disclosure state was
 * lost. This component is that single parent-owned boundary: it is rendered —
 * keyed `card.renderKey` (derived ONLY from the immutable `occurrenceKey`) —
 * once per occurrence, in canonical order, and it renders either the full
 * `SessionExerciseCard` or the compact `UpcomingExerciseRow`. Because the
 * boundary instance is never reparented, the draft and the open disclosure it
 * owns survive the representation change; the visual representations stay
 * distinct, and nothing is stored globally or persisted.
 */
export function SessionOccurrence({
  card,
  log,
  representation,
  upcomingPosition,
  sessionId,
  expectedSessionVersion,
  programSlug,
  weekNumber,
  workoutOrder,
}: SessionOccurrenceProps) {
  const hasLogger = card.logger !== null;
  const instanceKey = loggerInstanceKey(card);

  const [draft, setDraft] = useState<SetLoggerDraft>(() => draftFromCard(card));
  const [loadedInstanceKey, setLoadedInstanceKey] = useState(instanceKey);
  // An active card always shows its logger, so its disclosure starts revealed;
  // when it later crosses into the compact representation the logger stays
  // revealed instead of collapsing (open local UI state follows the occurrence).
  const [open, setOpen] = useState(card.kind === 'active');

  // Adjust the draft during render when the resolved logger instance changes
  // (a logged set or a new prefill) — the React "adjusting state when props
  // change" pattern. A pure reorder/substitution keeps the same key and the
  // draft survives untouched.
  if (loadedInstanceKey !== instanceKey) {
    setLoadedInstanceKey(instanceKey);
    setDraft(draftFromCard(card));
  }

  const controlledDraft = hasLogger ? draft : undefined;
  const controlledOnDraftChange = hasLogger ? setDraft : undefined;

  if (representation === 'upcoming') {
    return (
      <UpcomingExerciseRow
        exercise={card}
        log={log}
        className={upcomingGroupClassName(upcomingPosition)}
        band="upcoming"
        draft={controlledDraft}
        onDraftChange={controlledOnDraftChange}
        detailsOpen={hasLogger ? open : undefined}
        onDetailsOpenChange={hasLogger ? setOpen : undefined}
        sessionId={sessionId}
        expectedSessionVersion={expectedSessionVersion}
        programSlug={programSlug}
        weekNumber={weekNumber}
        workoutOrder={workoutOrder}
      />
    );
  }

  return (
    <li className="list-none">
      <SessionExerciseCard
        card={card}
        log={log}
        draft={controlledDraft}
        onDraftChange={controlledOnDraftChange}
        loggerOpen={hasLogger ? open : undefined}
        onLoggerOpenChange={hasLogger ? setOpen : undefined}
        sessionId={sessionId}
        expectedSessionVersion={expectedSessionVersion}
        programSlug={programSlug}
        weekNumber={weekNumber}
        workoutOrder={workoutOrder}
      />
    </li>
  );
}