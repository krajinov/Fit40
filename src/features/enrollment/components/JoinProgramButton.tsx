'use client';

import { useActionState } from 'react';

import { joinProgramAction } from '@/features/enrollment/actions/join-program';
import { EnrollmentActionError } from '@/features/enrollment/components/EnrollmentActionError';
import type { EnrollmentActionState } from '@/features/enrollment/types/enrollment-action-state';

const initialState: EnrollmentActionState = { ok: true };

interface JoinProgramButtonProps {
  readonly programSlug: string;
}

/**
 * Primary enrollment action. The program slug is supplied by the server
 * component as a prop; no user id ever travels in the form data.
 */
export function JoinProgramButton({ programSlug }: JoinProgramButtonProps) {
  async function submitAction(
    prev: EnrollmentActionState,
    formData: FormData,
  ): Promise<EnrollmentActionState> {
    formData.set('programSlug', programSlug);
    return joinProgramAction(formData);
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
          {pending ? 'Joining…' : 'Join plan'}
        </button>
      </form>
      {!state.ok && <EnrollmentActionError error={state.error} />}
    </div>
  );
}
