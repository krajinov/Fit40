'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';

import { moveExerciseAction } from '@/features/sessions/actions/move-exercise';
import { skipExerciseAction } from '@/features/sessions/actions/skip-exercise';
import { unskipExerciseAction } from '@/features/sessions/actions/unskip-exercise';
import { SessionActionError } from '@/features/sessions/components/SessionActionError';
import { sessionActionErrorLabel } from '@/features/sessions/session-action-labels';
import { shouldRefreshAfterSessionMutationError } from '@/features/sessions/session-mutation-refresh';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';
import {
  MOVE_DOWN_LABEL,
  MOVE_UP_LABEL,
  SKIP_LABEL,
  UNSKIP_LABEL,
  type SessionAdjustmentView,
} from '@/features/sessions/session-adjustment-views';

const initialState: SessionActionState = { ok: true };

/** The quiet-pill styling shared by every control of this panel. */
const quietControlClass =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-pill px-3 py-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50';

interface SessionExerciseAdjustPanelProps {
  readonly sessionId: string;
  readonly exerciseOrder: number;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  /**
   * The occurrence's adjustment affordance, derived server-side from the
   * domain's eligibility projection by the pure view mapper: which skip
   * control renders (`open`/`skipped`), and whether each adjacent move
   * control may render (`canMoveUp`/`canMoveDown` — the domain's facts,
   * never re-derived here from position, skip state or logged sets). The
   * `hidden` state never reaches this panel from the card; it defensively
   * renders nothing if it ever does.
   */
  readonly adjustment: SessionAdjustmentView;
}

/**
 * Occurrence adjustment control (M10) of one exercise card: the skip path
 * (`open` posts to `skipExerciseAction` "Skip exercise"; `skipped` posts to
 * `unskipExerciseAction` "Undo skip") and the adjacent-move path (M10 Slice 6:
 * quiet "Move up"/"Move down" posts to `moveExerciseAction` with an exact
 * `up`/`down` direction). A native `<form>` with `useActionState` — no
 * confirmation step (a skip is reversible while the session is in progress,
 * so the undo IS the confirmation; a move is likewise reversible by moving
 * back).
 *
 * Move visibility comes only from the view mapper's `canMoveUp`/
 * `canMoveDown` — the domain's adjacency facts, never re-derived from
 * position, skip state or logged sets. A skipped occurrence still moves
 * (only the skip DECISION is tied to it), and a `blocked-logged-sets`
 * occurrence still moves: logged sets freeze the skip decision only, never
 * a reorder — so the panel can show the blocked copy AND the move controls
 * at once.
 *
 * Two `useActionState` hooks — one for the skip path, one for the move path
 * (they post to different actions, so they cannot share a form action) —
 * with one COMBINED pending flag that disables every control of this
 * occurrence's panel while any mutation is in flight, so a second click can
 * never submit a duplicate, the wrong form, or the wrong direction. The move
 * buttons submit their own form's `direction` hidden input — never a shared
 * mutable variable that could race between clicks.
 *
 * Expected action errors surface as user-facing copy via
 * `sessionActionErrorLabel`; whether a failed submit must additionally
 * trigger the established reload/retry pattern (`router.refresh()`, matching
 * every other session mutation) is decided centrally by
 * `shouldRefreshAfterSessionMutationError` (`session-mutation-refresh.ts`),
 * which the skip/unskip/move paths share with the swap panel.
 */
export function SessionExerciseAdjustPanel({
  sessionId,
  exerciseOrder,
  programSlug,
  weekNumber,
  workoutOrder,
  adjustment,
}: SessionExerciseAdjustPanelProps) {
  const router = useRouter();
  const state = adjustment.state;

  /**
   * The shared session/route coordinates every submission carries — the
   * action revalidates the session path from them, so a successful move's
   * canonical server order reaches the client through the established
   * revalidation + refresh pattern.
   */
  function applyRouteFields(formData: FormData): void {
    formData.set('sessionId', sessionId);
    formData.set('exerciseOrder', String(exerciseOrder));
    formData.set('programSlug', programSlug);
    formData.set('weekNumber', String(weekNumber));
    formData.set('workoutOrder', String(workoutOrder));
  }

  async function submitSkip(
    _prev: SessionActionState,
    formData: FormData,
  ): Promise<SessionActionState> {
    applyRouteFields(formData);
    const result = await skipExerciseAction(formData);
    if (!result.ok && shouldRefreshAfterSessionMutationError(result.error.code)) {
      router.refresh();
    }
    return result;
  }

  async function submitUnskip(
    _prev: SessionActionState,
    formData: FormData,
  ): Promise<SessionActionState> {
    applyRouteFields(formData);
    const result = await unskipExerciseAction(formData);
    if (!result.ok && shouldRefreshAfterSessionMutationError(result.error.code)) {
      router.refresh();
    }
    return result;
  }

  /**
   * The direction arrives ONLY as the submitted form's own hidden input —
   * never from component state — so two rapid clicks on opposite arrows can
   * never cross wires: each form submits exactly its own direction.
   */
  async function submitMove(
    _prev: SessionActionState,
    formData: FormData,
  ): Promise<SessionActionState> {
    applyRouteFields(formData);
    const result = await moveExerciseAction(formData);
    if (!result.ok && shouldRefreshAfterSessionMutationError(result.error.code)) {
      router.refresh();
    }
    return result;
  }

  // Two state hooks, never one: the skip path and the move path post to
  // different actions, so they CANNOT share a form action. The move forms
  // share ONE hook because the direction arrives as the submitted form's own
  // hidden input — never from component state — so two rapid clicks on
  // opposite arrows can never cross wires. The pending flags are combined
  // below so any in-flight mutation disables every control of this panel:
  // a second click cannot submit the wrong form or direction.
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
        <form action={skipFormAction}>
          <button type="submit" disabled={pending} className={quietControlClass}>
            {skipPending
              ? state === 'open'
                ? 'Skipping…'
                : 'Restoring…'
              : state === 'open'
                ? SKIP_LABEL
                : UNSKIP_LABEL}
          </button>
        </form>
      )}

      {(adjustment.canMoveUp || adjustment.canMoveDown) && (
        <div className="flex flex-wrap items-center gap-2">
          {adjustment.canMoveUp && (
            <form action={moveFormAction}>
              <input type="hidden" name="direction" value="up" />
              <button type="submit" disabled={pending} className={quietControlClass}>
                {movePending ? 'Moving…' : MOVE_UP_LABEL}
              </button>
            </form>
          )}
          {adjustment.canMoveDown && (
            <form action={moveFormAction}>
              <input type="hidden" name="direction" value="down" />
              <button type="submit" disabled={pending} className={quietControlClass}>
                {movePending ? 'Moving…' : MOVE_DOWN_LABEL}
              </button>
            </form>
          )}
        </div>
      )}

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
