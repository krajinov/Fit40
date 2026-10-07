'use client';

import { useActionState } from 'react';

import { cn } from '@/lib/utils';
import { recordNotPerformedAction } from '@/features/schedule/actions/record-not-performed';
import { ScheduleActionError } from '@/features/schedule/components/ScheduleActionError';
import { ScheduleActionSubmitButton } from '@/features/schedule/components/ScheduleActionSubmitButton';
import type { ScheduleActionState } from '@/features/schedule/types/schedule-action-state';

const initialState: ScheduleActionState = { ok: true };

interface RecordNotPerformedFormProps {
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  /**
   * Whether this occurrence already has a live session — the M15 status the
   * server resolved. Presentation NEVER inspects logged sets to guess whether
   * recording will succeed: it only decides whether the honesty sentence is
   * shown, and the use case remains authoritative for the outcome.
   */
  readonly inProgress: boolean;
  readonly className?: string;
}

/**
 * Record-as-not-performed control (M17 Slice 11): a native form posting the
 * authored coordinates only — no enrollment id, no database id, no clock and
 * no client-side eligibility decision travel with it, so the server decides
 * everything (including the refusal when logged work exists, which surfaces
 * below as the use case's own message).
 *
 * The locked action label is `Didn't train this`. For a workout the user has
 * already started the form additionally states that recording removes the
 * empty workout in progress — the fact this action will establish — and no
 * confirmation dialog is used (Undo is the safety mechanism).
 */
export function RecordNotPerformedForm({
  programSlug,
  weekNumber,
  workoutOrder,
  inProgress,
  className,
}: RecordNotPerformedFormProps) {
  async function submitAction(
    _prev: ScheduleActionState,
    formData: FormData,
  ): Promise<ScheduleActionState> {
    formData.set('programSlug', programSlug);
    formData.set('weekNumber', String(weekNumber));
    formData.set('workoutOrder', String(workoutOrder));
    return recordNotPerformedAction(formData);
  }

  const [state, formAction] = useActionState(submitAction, initialState);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <form action={formAction} className="flex flex-col gap-1.5">
        {inProgress && (
          <p className="text-[11px] leading-snug text-ink-3">
            Recording removes the empty workout you have in progress.
          </p>
        )}
        <ScheduleActionSubmitButton label="Didn't train this" pendingLabel="Saving…" />
      </form>
      {!state.ok && <ScheduleActionError error={state.error} />}
    </div>
  );
}
