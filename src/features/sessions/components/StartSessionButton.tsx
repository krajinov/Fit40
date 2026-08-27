'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';

import { startSessionAction } from '@/features/sessions/actions/start-session';
import { SessionActionError } from '@/features/sessions/components/SessionActionError';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

const initialState: SessionActionState = { ok: true };

interface StartSessionButtonProps {
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

export function StartSessionButton({
  programSlug,
  weekNumber,
  workoutOrder,
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
    <div className="flex flex-col items-start gap-2">
      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {pending ? 'Starting…' : 'Start workout'}
        </button>
      </form>
      {!state.ok && <SessionActionError error={state.error} />}
    </div>
  );
}
