'use client';

import { useActionState, useState } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { leaveProgramAction } from '@/features/enrollment/actions/leave-program';
import { EnrollmentActionError } from '@/features/enrollment/components/EnrollmentActionError';
import type { EnrollmentActionState } from '@/features/enrollment/types/enrollment-action-state';

const initialState: EnrollmentActionState = { ok: true };

interface LeaveProgramButtonProps {
  readonly programSlug: string;
  readonly className?: string;
}

/**
 * Secondary destructive enrollment action with an inline two-step
 * confirmation: the first click reveals the consequence and the confirm /
 * cancel controls, the second submits the mutation. No user id ever travels
 * in the form data.
 */
export function LeaveProgramButton({ programSlug, className }: LeaveProgramButtonProps) {
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
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'sm' }),
          'text-ink-3 hover:text-destructive',
          className,
        )}
      >
        Leave plan
      </button>
    );
  }

  return (
    <div
      className={cn(
        'flex w-full flex-col items-start gap-3 rounded-control border border-border bg-surface-2/40 p-4',
        className,
      )}
    >
      <p className="text-sm text-foreground">
        Leave this program? Your progress in this program will be reset. Your logged
        workouts are kept in your history.
      </p>
      <div className="flex items-center gap-3">
        <form action={formAction}>
          <button
            type="submit"
            disabled={pending}
            className={buttonVariants({ variant: 'destructive', size: 'sm' })}
          >
            {pending ? 'Leaving…' : 'Confirm leave'}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          Cancel
        </button>
      </div>
      {!state.ok && <EnrollmentActionError error={state.error} />}
    </div>
  );
}
