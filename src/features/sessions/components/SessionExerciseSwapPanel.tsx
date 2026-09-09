'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, RotateCcw } from 'lucide-react';

import { SelectableRadioCard } from '@/components/shared/SelectableRadioCard';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { substituteExerciseAction } from '@/features/sessions/actions/substitute-exercise';
import { restoreExerciseAction } from '@/features/sessions/actions/restore-exercise';
import { SessionActionError } from '@/features/sessions/components/SessionActionError';
import { sessionActionErrorLabel } from '@/features/sessions/session-action-labels';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';
import {
  SUBSTITUTION_EMPTY_CANDIDATES_LABEL,
  SUBSTITUTION_LIMITED_LABEL,
  type SessionSubstitutionCandidateView,
} from '@/features/sessions/session-substitution-views';

const initialState: SessionActionState = { ok: true };

/**
 * Stale-state outcomes of a substitution/restore submit: the page's view of
 * the occurrence no longer matches the persisted session, so the caller must
 * reload the latest state. `SESSION_MODIFIED` means another tab changed the
 * session (optimistic-concurrency version); `SUBSTITUTION_NO_CHANGE` means
 * another tab already applied the same swap/restore, so this tab still shows
 * an outdated exercise identity. Ordinary validation/business errors (e.g.
 * `EXERCISE_HAS_LOGGED_SETS`, `VALIDATION_ERROR`) are about the persisted
 * state itself, not staleness, and must NOT trigger a reload.
 */
function isStaleSessionState(state: SessionActionState): boolean {
  if (state.ok) return false;
  return state.error.code === 'SESSION_MODIFIED' || state.error.code === 'SUBSTITUTION_NO_CHANGE';
}

interface SessionExerciseSwapPanelProps {
  readonly sessionId: string;
  readonly exerciseOrder: number;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  /**
   * The substitution affordance data of this occurrence, derived server-side
   * from the domain's eligibility projection by the pure view mapper (replace
   * / restore-available states). Hidden and blocked states never render this
   * panel at all.
   */
  readonly substitution: {
    readonly canRestore: boolean;
    readonly candidates: ReadonlyArray<SessionSubstitutionCandidateView>;
    readonly candidatesLimited: boolean;
  };
}

/**
 * Exercise substitution control (M9) of one occurrence card. The swap picker
 * is a native disclosure (`<details>`) with native radio cards — arrow-key
 * navigation and form submission work with zero extra client state — and the
 * submit posts to `substituteExerciseAction` through `useActionState`. The
 * restore control is a separate native form posting to
 * `restoreExerciseAction`, rendered only when the domain's eligibility
 * projection says restore is currently possible (`canRestore`, already
 * decided upstream of this component).
 *
 * Expected action errors surface as user-facing copy via
 * `sessionActionErrorLabel`; stale-state outcomes (`SESSION_MODIFIED`,
 * `SUBSTITUTION_NO_CHANGE` — another tab already changed/applied the same
 * swap) additionally trigger the established reload/retry pattern
 * (`router.refresh()`), matching every other session mutation.
 */
export function SessionExerciseSwapPanel({
  sessionId,
  exerciseOrder,
  programSlug,
  weekNumber,
  workoutOrder,
  substitution,
}: SessionExerciseSwapPanelProps) {
  const router = useRouter();

  async function submitSubstitute(
    _prev: SessionActionState,
    formData: FormData,
  ): Promise<SessionActionState> {
    formData.set('sessionId', sessionId);
    formData.set('exerciseOrder', String(exerciseOrder));
    formData.set('programSlug', programSlug);
    formData.set('weekNumber', String(weekNumber));
    formData.set('workoutOrder', String(workoutOrder));
    const state = await substituteExerciseAction(formData);
    if (isStaleSessionState(state)) {
      router.refresh();
    }
    return state;
  }

  async function submitRestore(
    _prev: SessionActionState,
    formData: FormData,
  ): Promise<SessionActionState> {
    formData.set('sessionId', sessionId);
    formData.set('exerciseOrder', String(exerciseOrder));
    formData.set('programSlug', programSlug);
    formData.set('weekNumber', String(weekNumber));
    formData.set('workoutOrder', String(workoutOrder));
    const state = await restoreExerciseAction(formData);
    if (isStaleSessionState(state)) {
      router.refresh();
    }
    return state;
  }

  const [substituteState, substituteFormAction, substitutePending] = useActionState(
    submitSubstitute,
    initialState,
  );
  const [restoreState, restoreFormAction, restorePending] = useActionState(
    submitRestore,
    initialState,
  );

  return (
    <div className="flex flex-col gap-2">
      {substitution.canRestore && (
        <form action={restoreFormAction}>
          <button
            type="submit"
            disabled={restorePending}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-pill px-3 py-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            {restorePending ? 'Restoring…' : 'Restore original exercise'}
          </button>
        </form>
      )}

      <details className="group/swap -mx-1">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-pill px-3 py-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink [&::-webkit-details-marker]:hidden">
          Swap exercise
          <ChevronDown
            aria-hidden="true"
            className="size-4 text-ink-3 transition-transform group-open/swap:rotate-180"
          />
        </summary>

        {substitution.candidates.length > 0 ? (
          <form action={substituteFormAction} className="flex flex-col gap-3 pt-3">
            <fieldset>
              <legend className="sr-only">Replacement exercise</legend>
              <div className="flex flex-col gap-2">
                {substitution.candidates.map((candidate) => (
                  <SelectableRadioCard
                    key={candidate.exerciseId}
                    name="replacementExerciseId"
                    value={candidate.exerciseId}
                    label={candidate.name}
                    hint={candidate.metaLabel}
                  />
                ))}
              </div>
            </fieldset>
            {substitution.candidatesLimited && (
              <p className="text-xs text-ink-3">{SUBSTITUTION_LIMITED_LABEL}</p>
            )}
            <div>
              <button
                type="submit"
                disabled={substitutePending}
                className={cn(buttonVariants({ size: 'sm' }), 'w-full md:w-auto')}
              >
                {substitutePending ? 'Swapping…' : 'Swap exercise'}
              </button>
            </div>
          </form>
        ) : (
          <p className="pt-3 text-[13px] text-ink-3">{SUBSTITUTION_EMPTY_CANDIDATES_LABEL}</p>
        )}
      </details>

      {!substituteState.ok && (
        <SessionActionError
          error={{
            code: substituteState.error.code,
            message: sessionActionErrorLabel(
              substituteState.error.code,
              substituteState.error.message,
            ),
          }}
        />
      )}
      {substitution.canRestore && !restoreState.ok && (
        <SessionActionError
          error={{
            code: restoreState.error.code,
            message: sessionActionErrorLabel(
              restoreState.error.code,
              restoreState.error.message,
            ),
          }}
        />
      )}
    </div>
  );
}
