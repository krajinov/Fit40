'use client';

import { useActionState } from 'react';

import { cn } from '@/lib/utils';
import { undoNotPerformedAction } from '@/features/schedule/actions/undo-not-performed';
import { ScheduleActionError } from '@/features/schedule/components/ScheduleActionError';
import { ScheduleActionSubmitButton } from '@/features/schedule/components/ScheduleActionSubmitButton';
import type { ScheduleActionState } from '@/features/schedule/types/schedule-action-state';

const initialState: ScheduleActionState = { ok: true };

interface UndoNotPerformedFormProps {
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  readonly className?: string;
}

/**
 * Undo control for a recorded occurrence (M17 Slice 11): a native form posting
 * the authored coordinates only, delegating to the Slice 7 undo use case —
 * which removes the recorded fact and nothing else. This component therefore
 * regenerates no calendar, creates no planned row, resurrects no session and
 * starts nothing; the occurrence simply goes back to not started on the next
 * read, exactly as the locked supporting copy says.
 */
export function UndoNotPerformedForm({
  programSlug,
  weekNumber,
  workoutOrder,
  className,
}: UndoNotPerformedFormProps) {
  async function submitAction(
    _prev: ScheduleActionState,
    formData: FormData,
  ): Promise<ScheduleActionState> {
    formData.set('programSlug', programSlug);
    formData.set('weekNumber', String(weekNumber));
    formData.set('workoutOrder', String(workoutOrder));
    return undoNotPerformedAction(formData);
  }

  const [state, formAction] = useActionState(submitAction, initialState);

  return (
    <div className={cn('flex flex-col items-start gap-1', className)}>
      <form action={formAction}>
        <ScheduleActionSubmitButton label="Undo" pendingLabel="Undoing…" />
      </form>
      <p className="text-[11px] leading-snug text-ink-3">It goes back to not started.</p>
      {!state.ok && <ScheduleActionError error={state.error} />}
    </div>
  );
}
