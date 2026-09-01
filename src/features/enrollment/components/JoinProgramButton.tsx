'use client';

import { useActionState } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { joinProgramAction } from '@/features/enrollment/actions/join-program';
import { EnrollmentActionError } from '@/features/enrollment/components/EnrollmentActionError';
import type { EnrollmentActionState } from '@/features/enrollment/types/enrollment-action-state';

const initialState: EnrollmentActionState = { ok: true };

interface JoinProgramButtonProps {
  readonly programSlug: string;
  readonly className?: string;
}

/**
 * Primary enrollment action. The program slug is supplied by the server
 * component as a prop; no user id ever travels in the form data.
 */
export function JoinProgramButton({ programSlug, className }: JoinProgramButtonProps) {
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
      <form action={formAction} className={cn('w-full', className)}>
        <button
          type="submit"
          disabled={pending}
          className={cn(buttonVariants(), 'w-full')}
        >
          {pending ? 'Joining…' : 'Join plan'}
        </button>
      </form>
      {!state.ok && <EnrollmentActionError error={state.error} />}
    </div>
  );
}
