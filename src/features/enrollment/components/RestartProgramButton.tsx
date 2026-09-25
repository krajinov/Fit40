'use client';

import { useActionState } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { restartProgramAction } from '@/features/enrollment/actions/restart-program';
import { EnrollmentActionError } from '@/features/enrollment/components/EnrollmentActionError';
import type { EnrollmentActionState } from '@/features/enrollment/types/enrollment-action-state';

const initialState: EnrollmentActionState = { ok: true };

interface RestartProgramButtonProps {
  readonly programSlug: string;
  readonly className?: string;
}

/**
 * Primary restart action on the completion screen. The program slug is
 * supplied by the server component as a prop; the form submits only that
 * field — no user id and no enrollment id ever travel in the form data, and
 * no completion state is checked on the client (the Server Action's use case
 * is authoritative). While pending the submit is disabled so a restart can
 * never be dispatched twice.
 */
export function RestartProgramButton({ programSlug, className }: RestartProgramButtonProps) {
  async function submitAction(
    prev: EnrollmentActionState,
    formData: FormData,
  ): Promise<EnrollmentActionState> {
    formData.set('programSlug', programSlug);
    return restartProgramAction(formData);
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
          {pending ? 'Restarting…' : 'Start program again'}
        </button>
      </form>
      {!state.ok && <EnrollmentActionError error={state.error} />}
    </div>
  );
}