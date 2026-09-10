'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';

import { skipExerciseAction } from '@/features/sessions/actions/skip-exercise';
import { unskipExerciseAction } from '@/features/sessions/actions/unskip-exercise';
import { SessionActionError } from '@/features/sessions/components/SessionActionError';
import { sessionActionErrorLabel } from '@/features/sessions/session-action-labels';
import { shouldRefreshAfterSessionMutationError } from '@/features/sessions/session-mutation-refresh';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';
import {
  SKIP_LABEL,
  UNSKIP_LABEL,
  type SessionAdjustmentControlState,
} from '@/features/sessions/session-adjustment-views';

const initialState: SessionActionState = { ok: true };

interface SessionExerciseAdjustPanelProps {
  readonly sessionId: string;
  readonly exerciseOrder: number;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  /**
   * The skip affordance state of this occurrence, derived server-side from
   * the domain's eligibility projection by the pure view mapper. Only the
   * interactive states (`open`, `skipped`) render this panel at all; hidden
   * and blocked states never reach it.
   */
  readonly state: SessionAdjustmentControlState;
}

/**
 * Occurrence skip control (M10) of one exercise card: `open` posts to
 * `skipExerciseAction` ("Skip exercise"), `skipped` posts to
 * `unskipExerciseAction` ("Undo skip"). A native `<form>` with
 * `useActionState` — no confirmation step (a skip is reversible while the
 * session is in progress, so the undo IS the confirmation).
 *
 * Expected action errors surface as user-facing copy via
 * `sessionActionErrorLabel`; whether a failed submit must additionally
 * trigger the established reload/retry pattern (`router.refresh()`, matching
 * every other session mutation) is decided centrally by
 * `shouldRefreshAfterSessionMutationError` (`session-mutation-refresh.ts`),
 * which the skip/unskip paths share with the swap panel.
 */
export function SessionExerciseAdjustPanel({
  sessionId,
  exerciseOrder,
  programSlug,
  weekNumber,
  workoutOrder,
  state,
}: SessionExerciseAdjustPanelProps) {
  const router = useRouter();

  async function submitSkip(
    _prev: SessionActionState,
    formData: FormData,
  ): Promise<SessionActionState> {
    formData.set('sessionId', sessionId);
    formData.set('exerciseOrder', String(exerciseOrder));
    formData.set('programSlug', programSlug);
    formData.set('weekNumber', String(weekNumber));
    formData.set('workoutOrder', String(workoutOrder));
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
    formData.set('sessionId', sessionId);
    formData.set('exerciseOrder', String(exerciseOrder));
    formData.set('programSlug', programSlug);
    formData.set('weekNumber', String(weekNumber));
    formData.set('workoutOrder', String(workoutOrder));
    const result = await unskipExerciseAction(formData);
    if (!result.ok && shouldRefreshAfterSessionMutationError(result.error.code)) {
      router.refresh();
    }
    return result;
  }

  const [skipState, skipFormAction, skipPending] = useActionState(submitSkip, initialState);
  const [unskipState, unskipFormAction, unskipPending] = useActionState(
    submitUnskip,
    initialState,
  );

  return (
    <div className="flex flex-col gap-2">
      {state === 'open' ? (
        <form action={skipFormAction}>
          <button
            type="submit"
            disabled={skipPending}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-pill px-3 py-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
          >
            {skipPending ? 'Skipping…' : SKIP_LABEL}
          </button>
        </form>
      ) : (
        <form action={unskipFormAction}>
          <button
            type="submit"
            disabled={unskipPending}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-pill px-3 py-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
          >
            {unskipPending ? 'Restoring…' : UNSKIP_LABEL}
          </button>
        </form>
      )}

      {state === 'open' && !skipState.ok && (
        <SessionActionError
          error={{
            code: skipState.error.code,
            message: sessionActionErrorLabel(skipState.error.code, skipState.error.message),
          }}
        />
      )}
      {state === 'skipped' && !unskipState.ok && (
        <SessionActionError
          error={{
            code: unskipState.error.code,
            message: sessionActionErrorLabel(unskipState.error.code, unskipState.error.message),
          }}
        />
      )}
    </div>
  );
}
