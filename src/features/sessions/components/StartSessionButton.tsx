'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { startSessionAction } from '@/features/sessions/actions/start-session';
import { SessionActionError } from '@/features/sessions/components/SessionActionError';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

const initialState: SessionActionState = { ok: true };

interface StartSessionButtonProps {
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  readonly fullWidth?: boolean;
}

/**
 * "Start workout" primary action. The CONTRACT is unchanged: the user id
 * comes from the trusted session, a concurrent start that wins the race
 * (SESSION_ALREADY_EXISTS) reloads the page to load the existing session.
 */
export function StartSessionButton({
  programSlug,
  weekNumber,
  workoutOrder,
  fullWidth = false,
}: StartSessionButtonProps) {
  const router = useRouter();

  async function submitAction(
    prev: SessionActionState,
    formData: FormData,
  ): Promise<SessionActionState> {
    formData.set('programSlug', programSlug);
    formData.set('weekNumber', String(weekNumber));
    formData.set('workoutOrder', String(workoutOrder));
    const state = await startSessionAction(formData);
    if (!state.ok && state.error.code === 'SESSION_ALREADY_EXISTS') {
      // A concurrent start won the race: load the existing session.
      router.refresh();
    }
    return state;
  }

  const [state, formAction, pending] = useActionState(submitAction, initialState);

  return (
    <div className={cn('flex flex-col items-start gap-2', fullWidth && 'w-full')}>
      <form action={formAction} className={fullWidth ? 'w-full' : undefined}>
        <button
          type="submit"
          disabled={pending}
          className={cn(buttonVariants(), fullWidth && 'w-full')}
        >
          {pending ? 'Starting…' : 'Start workout'}
        </button>
      </form>
      {!state.ok && <SessionActionError error={state.error} />}
    </div>
  );
}
