'use client';

import { useActionState, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';

import type { ExerciseSummaryDto } from '@/application/dto/exercise';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { addExerciseAction } from '@/features/sessions/actions/add-exercise';
import {
  ADD_EXERCISE_EMPTY_LABEL,
  ADD_EXERCISE_LABEL,
  ADD_EXERCISE_NO_CATALOG_LABEL,
  ADD_EXERCISE_SUBMIT_LABEL,
  filterAddableExercises,
} from '@/features/sessions/add-exercise-views';
import { SessionActionError } from '@/features/sessions/components/SessionActionError';
import { AddExerciseCatalogOptions } from '@/features/sessions/components/AddExerciseCatalogOptions';
import { AddExercisePrescriptionFields } from '@/features/sessions/components/AddExercisePrescriptionFields';
import { sessionActionErrorLabel } from '@/features/sessions/session-action-labels';
import { createSessionMutationSubmit } from '@/features/sessions/session-mutation-submit';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

const initialState: SessionActionState = { ok: true };

interface AddSessionExercisePanelProps {
  readonly sessionId: string;
  /**
   * The rendered snapshot's session version (PR #13 Finding 1), submitted so
   * the use case can reject stale rendered intent before appending.
   */
  readonly expectedSessionVersion: number;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  /** The full catalog from the screen's single catalog read (may be empty). */
  readonly addableExercises: ReadonlyArray<ExerciseSummaryDto>;
}

/**
 * Explicit "Add exercise" control of the Active Workout screen (M11) — the
 * CLIENT BOUNDARY of the Add flow, and NOT occurrence-owned state: it never
 * touches an occurrence's logger draft or disclosure, so appending an
 * occurrence cannot disturb the existing keyed occurrence list.
 *
 * The search field filters the ALREADY-LOADED catalog for display only and
 * sits outside the `<form>`, so typing (including Enter) never submits;
 * selection and submission are native radios + native submit through
 * `useActionState`. The prescription inputs live in their own client island
 * (`AddExercisePrescriptionFields`) and start empty — there is no default
 * prescription, no auto-selected exercise and no AI suggestion.
 *
 * Expected errors surface as user-facing copy via `sessionActionErrorLabel`;
 * the reload decision for stale server state stays centralized in
 * `shouldRefreshAfterSessionMutationError` through
 * `createSessionMutationSubmit` (the same refresh path every other session
 * mutation uses — never a parallel one).
 */
export function AddSessionExercisePanel({
  sessionId,
  expectedSessionVersion,
  programSlug,
  weekNumber,
  workoutOrder,
  addableExercises,
}: AddSessionExercisePanelProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const searchId = useId();

  function applyRouteFields(formData: FormData): void {
    formData.set('sessionId', sessionId);
    formData.set('expectedSessionVersion', String(expectedSessionVersion));
    formData.set('programSlug', programSlug);
    formData.set('weekNumber', String(weekNumber));
    formData.set('workoutOrder', String(workoutOrder));
  }

  const submit = createSessionMutationSubmit({
    router,
    applyRouteFields,
    action: addExerciseAction,
  });
  const [state, formAction, pending] = useActionState(submit, initialState);

  const visibleExercises = filterAddableExercises(addableExercises, query);
  const emptyLabel =
    addableExercises.length === 0 ? ADD_EXERCISE_NO_CATALOG_LABEL : ADD_EXERCISE_EMPTY_LABEL;

  return (
    <details className="group/add rounded-card border border-border bg-card px-4 py-3 md:px-6 md:py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-1 text-sm font-semibold text-ink transition-colors [&::-webkit-details-marker]:hidden">
        {ADD_EXERCISE_LABEL}
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-ink-3 transition-transform group-open/add:rotate-180"
        />
      </summary>

      <div className="flex flex-col gap-3 pt-3">
        <div>
          <label
            htmlFor={searchId}
            className="mb-1.5 block text-[11px] font-medium text-ink-2 md:text-[13px]"
          >
            Search the exercise catalog
          </label>
          <Input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, equipment or muscle"
            className="h-12 rounded-[10px] md:h-[52px] md:rounded-control"
          />
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          <AddExerciseCatalogOptions exercises={visibleExercises} emptyLabel={emptyLabel} />
          <AddExercisePrescriptionFields />

          <div>
            <button
              type="submit"
              disabled={pending}
              className={cn(buttonVariants({ size: 'sm' }), 'w-full md:w-auto')}
            >
              {pending ? 'Adding…' : ADD_EXERCISE_SUBMIT_LABEL}
            </button>
          </div>
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
    </details>
  );
}
