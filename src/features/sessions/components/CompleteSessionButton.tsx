'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';

import { completeSessionAction } from '@/features/sessions/actions/complete-session';
import { SessionActionError } from '@/features/sessions/components/SessionActionError';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

const initialState: SessionActionState = { ok: true };

interface CompleteSessionButtonProps {
  readonly sessionId: string;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

export function CompleteSessionButton({
  sessionId,
  programSlug,
  weekNumber,
  workoutOrder,
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
    <div className="flex flex-col items-start gap-2">
      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-md bg-green-600 px-6 py-3 text-sm font-medium text-white hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {pending ? 'Completing…' : 'Complete workout'}
        </button>
      </form>
      {!state.ok && <SessionActionError error={state.error} />}
    </div>
  );
}
