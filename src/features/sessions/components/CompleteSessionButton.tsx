'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { completeSessionAction } from '@/features/sessions/actions/complete-session';
import { SessionActionError } from '@/features/sessions/components/SessionActionError';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

const initialState: SessionActionState = { ok: true };

interface CompleteSessionButtonProps {
  readonly sessionId: string;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  /** Full-width rendering for the mobile sticky bottom bar. */
  readonly fullWidth?: boolean;
  readonly className?: string;
}

/**
 * "Finish workout" primary action (locked design). In-progress sessions only;
 * the completion CONTRACT (validation, optimistic version handling,
 * revalidation, redirect-free Result) is unchanged from the pre-redesign
 * button.
 */
export function CompleteSessionButton({
  sessionId,
  programSlug,
  weekNumber,
  workoutOrder,
  fullWidth = false,
  className,
}: CompleteSessionButtonProps) {
  const router = useRouter();

  async function submitAction(
    prev: SessionActionState,
    formData: FormData,
  ): Promise<SessionActionState> {
    formData.set('sessionId', sessionId);
    formData.set('programSlug', programSlug);
    formData.set('weekNumber', String(weekNumber));
    formData.set('workoutOrder', String(workoutOrder));
    const state = await completeSessionAction(formData);
    if (!state.ok && state.error.code === 'SESSION_MODIFIED') {
      router.refresh();
    }
    return state;
  }

  const [state, formAction, pending] = useActionState(submitAction, initialState);

  return (
    <div className={cn('flex flex-col gap-2', fullWidth && 'w-full', className)}>
      <form action={formAction} className={fullWidth ? 'w-full' : undefined}>
        <button
          type="submit"
          disabled={pending}
          className={cn(buttonVariants(), fullWidth && 'w-full')}
        >
          {pending ? 'Finishing…' : 'Finish workout'}
        </button>
      </form>
      {!state.ok && <SessionActionError error={state.error} />}
    </div>
  );
}
