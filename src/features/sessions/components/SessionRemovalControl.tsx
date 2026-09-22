'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';

import type { OccurrenceRemovalEligibilityDto } from '@/application/dto/workout-session';

import { removeExerciseAction } from '@/features/sessions/actions/remove-exercise';
import { SessionActionError } from '@/features/sessions/components/SessionActionError';
import { sessionActionErrorLabel } from '@/features/sessions/session-action-labels';
import { createSessionMutationSubmit } from '@/features/sessions/session-mutation-submit';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

const initialState: SessionActionState = { ok: true };

/** Muted truthful copy when logged sets block removal. */
export const REMOVAL_BLOCKED_LABEL = 'Delete your logged sets to remove this exercise.';

/** Quiet control copy of the removable state. */
export const REMOVE_LABEL = 'Remove exercise';

interface SessionRemovalControlProps {
  readonly sessionId: string;
  readonly exerciseOrder: number;
  /**
   * The rendered snapshot's session version (PR #13 Finding 1), submitted so
   * the use case can reject stale rendered intent before interpreting the
   * mutable `exerciseOrder`.
   */
  readonly expectedSessionVersion: number;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  /**
   * The occurrence's domain-derived removal eligibility, copied verbatim from
   * the session DTO. This component makes NO removal decision of its own: it
   * never inspects provenance or set counts, it only formats the state it is
   * handed.
   */
  readonly removalEligibility: OccurrenceRemovalEligibilityDto;
}

/**
 * Remove control for ONE user-added occurrence (M11) — a quiet client
 * boundary, matching the other occurrence islands (skip/move, swap/restore).
 *
 * States:
 * - `canRemove`            → the quiet Remove form.
 * - `blockedBy: logged-sets` → no control, the truthful muted copy.
 * - `blockedBy: template-authored` → NOTHING (Skip/Unskip is a template
 *   occurrence's exclusion mechanism; no warning is warranted).
 * - `blockedBy: session-completed` → NOTHING (mutations are frozen).
 *
 * Expected errors surface via `sessionActionErrorLabel`; the reload decision
 * for stale server state stays centralized in
 * `shouldRefreshAfterSessionMutationError` through
 * `createSessionMutationSubmit` — the same refresh path every other session
 * mutation uses.
 */
export function SessionRemovalControl({
  sessionId,
  exerciseOrder,
  expectedSessionVersion,
  programSlug,
  weekNumber,
  workoutOrder,
  removalEligibility,
}: SessionRemovalControlProps) {
  const router = useRouter();

  function applyRouteFields(formData: FormData): void {
    formData.set('sessionId', sessionId);
    formData.set('exerciseOrder', String(exerciseOrder));
    formData.set('expectedSessionVersion', String(expectedSessionVersion));
    formData.set('programSlug', programSlug);
    formData.set('weekNumber', String(weekNumber));
    formData.set('workoutOrder', String(workoutOrder));
  }

  const submit = createSessionMutationSubmit({
    router,
    applyRouteFields,
    action: removeExerciseAction,
  });
  const [state, formAction, pending] = useActionState(submit, initialState);

  if (!removalEligibility.canRemove) {
    // Only the logged-set block has user-facing copy; the other blocks render
    // nothing at all (their affordances live elsewhere or are frozen).
    return removalEligibility.blockedBy === 'logged-sets' ? (
      <p className="text-xs text-ink-3 md:text-[13px]">{REMOVAL_BLOCKED_LABEL}</p>
    ) : null;
  }

  return (
    <div className="flex flex-col gap-2">
      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-pill px-3 py-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
        >
          <Trash2 aria-hidden="true" className="size-4" />
          {pending ? 'Removing…' : REMOVE_LABEL}
        </button>
      </form>

      {!state.ok && (
        <SessionActionError
          error={{
            code: state.error.code,
            message: sessionActionErrorLabel(state.error.code, state.error.message),
          }}
        />
      )}
    </div>
  );
}
