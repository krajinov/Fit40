'use client';

import { useActionState, useState } from 'react';

import { leaveProgramAction } from '@/features/enrollment/actions/leave-program';
import { EnrollmentActionError } from '@/features/enrollment/components/EnrollmentActionError';
import type { EnrollmentActionState } from '@/features/enrollment/types/enrollment-action-state';

const initialState: EnrollmentActionState = { ok: true };

interface LeaveProgramButtonProps {
  readonly programSlug: string;
}

/**
 * Secondary destructive enrollment action with an inline two-step
 * confirmation: the first click reveals the consequence and the confirm /
 * cancel controls, the second submits the mutation. No user id ever travels
 * in the form data.
 */
export function LeaveProgramButton({ programSlug }: LeaveProgramButtonProps) {
  const [confirming, setConfirming] = useState(false);

  async function submitAction(
    prev: EnrollmentActionState,
    formData: FormData,
  ): Promise<EnrollmentActionState> {
    formData.set('programSlug', programSlug);
    return leaveProgramAction(formData);
  }

  const [state, formAction, pending] = useActionState(submitAction, initialState);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Leave plan
      </button>
    );
  }

  return (
    <div className="flex w-full flex-col items-start gap-3 rounded-lg border border-border bg-muted/40 p-4">
      <p className="text-sm text-foreground">
        Leave this program? Your progress in this program will be reset. Your logged
        workouts are kept in your history.
      </p>
      <div className="flex items-center gap-3">
        <form action={formAction}>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center justify-center rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {pending ? 'Leaving…' : 'Confirm leave'}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {!state.ok && <EnrollmentActionError error={state.error} />}
    </div>
  );
}
