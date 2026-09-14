'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';

import { moveExerciseAction } from '@/features/sessions/actions/move-exercise';
import { skipExerciseAction } from '@/features/sessions/actions/skip-exercise';
import { unskipExerciseAction } from '@/features/sessions/actions/unskip-exercise';
import { SessionActionError } from '@/features/sessions/components/SessionActionError';
import { SessionMoveControls } from '@/features/sessions/components/SessionMoveControls';
import { SessionSkipControl } from '@/features/sessions/components/SessionSkipControl';
import { sessionActionErrorLabel } from '@/features/sessions/session-action-labels';
import { createSessionMutationSubmit } from '@/features/sessions/session-mutation-submit';
import { type SessionAdjustmentView } from '@/features/sessions/session-adjustment-views';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

const initialState: SessionActionState = { ok: true };

interface SessionExerciseAdjustPanelProps {
  readonly sessionId: string;
  readonly exerciseOrder: number;
  /**
   * The rendered snapshot's session version (PR #13 Finding 1), submitted with
   * every adjustment so the use case can reject stale rendered intent before
   * interpreting the mutable `exerciseOrder`.
   */
  readonly expectedSessionVersion: number;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  /**
   * The occurrence's adjustment affordance, derived server-side from the
   * domain's eligibility projection by the pure view mapper — never
   * re-derived here. The `hidden` state never reaches this panel from the
   * card; it defensively renders nothing if it ever does.
   */
  readonly adjustment: SessionAdjustmentView;
}

/**
 * Occurrence adjustment control (M10) of one exercise card — the CLIENT
 * BOUNDARY of the adjustment affordance (PR #13 Finding 3 split). It owns
 * the only hooks: the router, the shared route-field application, the
 * `createSessionMutationSubmit` action functions, and the two
 * `useActionState` hooks (one for the skip path, one for the move path —
 * they post to different actions, so they cannot share a form action). The
 * skip and move MARKUP lives in the presentational islands
 * `SessionSkipControl`/`SessionMoveControls`, which hold no state and
 * receive their `formAction` from here. Adding a hook to an island would
 * silently drop the combined-pending guarantee — do not move hooks down.
 *
 * The two pending flags are COMBINED and passed to both islands: every
 * control of this panel is disabled while any mutation is in flight, so a
 * second click can never submit a duplicate, the wrong form, or the wrong
 * direction (the move buttons still submit their own form's `direction`
 * hidden input). Move visibility comes only from the view mapper's
 * `canMoveUp`/`canMoveDown` — never re-derived from position, skip state or
 * logged sets (a skipped or blocked occurrence still moves). Expected
 * errors surface via `sessionActionErrorLabel`; the reload/retry decision
 * (`router.refresh()`) stays centralized in `shouldRefreshAfterSession-
 * MutationError`, applied once inside `createSessionMutationSubmit`.
 */
export function SessionExerciseAdjustPanel({
  sessionId,
  exerciseOrder,
  expectedSessionVersion,
  programSlug,
  weekNumber,
  workoutOrder,
  adjustment,
}: SessionExerciseAdjustPanelProps) {
  const router = useRouter();
  const state = adjustment.state;


  /**
   * The shared session/route coordinates every submission carries — the
   * action revalidates the session path from them.
   */
  function applyRouteFields(formData: FormData): void {
    formData.set('sessionId', sessionId);
    formData.set('exerciseOrder', String(exerciseOrder));
    formData.set('expectedSessionVersion', String(expectedSessionVersion));
    formData.set('programSlug', programSlug);
    formData.set('weekNumber', String(weekNumber));
    formData.set('workoutOrder', String(workoutOrder));
  }

  // Three submission paths, one shared body: route fields → action → conditional refresh.
  const submitSkip = createSessionMutationSubmit({ router, applyRouteFields, action: skipExerciseAction });
  const submitUnskip = createSessionMutationSubmit({ router, applyRouteFields, action: unskipExerciseAction });
  const submitMove = createSessionMutationSubmit({ router, applyRouteFields, action: moveExerciseAction });

  // Two state hooks, never one: the skip path and the move path post to
  // different actions, so they CANNOT share a form action. The move forms
  // share ONE hook because the direction arrives as the submitted form's own
  // hidden input — never from component state — so two rapid clicks on
  // opposite arrows can never cross wires. The pending flags are combined
  // below so any in-flight mutation disables every control of this panel.
  const [skipState, skipFormAction, skipPending] = useActionState(
    state === 'open' ? submitSkip : submitUnskip,
    initialState,
  );
  const [moveState, moveFormAction, movePending] = useActionState(
    submitMove,
    initialState,
  );
  const pending = skipPending || movePending;
  const failed = !skipState.ok ? skipState : !moveState.ok ? moveState : null;

  // Completed/read-only occurrences render no mutation controls at all. The
  // card never mounts this panel for the mapper's `hidden` state — this is a
  // defensive no-op, and it deliberately sits AFTER the hooks so the hook
  // order stays unconditional even if the state flips across a refresh.
  if (state === 'hidden') {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {state === 'blocked-logged-sets' ? (
        <p className="text-xs text-ink-3 md:text-[13px]">{adjustment.blockedLabel}</p>
      ) : (
        <SessionSkipControl
          state={state}
          formAction={skipFormAction}
          pending={pending}
          busy={skipPending}
        />
      )}

      <SessionMoveControls
        canMoveUp={adjustment.canMoveUp}
        canMoveDown={adjustment.canMoveDown}
        formAction={moveFormAction}
        pending={pending}
        busy={movePending}
      />

      {failed !== null && (
        <SessionActionError
          error={{
            code: failed.error.code,
            message: sessionActionErrorLabel(failed.error.code, failed.error.message),
          }}
        />
      )}
    </div>
  );
}
