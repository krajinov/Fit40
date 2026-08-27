'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

import { logSetAction } from '@/features/sessions/actions/log-set';
import { SessionActionError } from '@/features/sessions/components/SessionActionError';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

const initialState: SessionActionState = { ok: true };

interface SetLoggerFormProps {
  readonly sessionId: string;
  readonly exerciseOrder: number;
  readonly prescription: RepPrescription;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

export function SetLoggerForm({
  sessionId,
  exerciseOrder,
  prescription,
  programSlug,
  weekNumber,
  workoutOrder,
}: SetLoggerFormProps) {
  const router = useRouter();
  const isReps = prescription.type === 'reps';

  async function submitAction(
    prev: SessionActionState,
    formData: FormData,
  ): Promise<SessionActionState> {
    formData.set('sessionId', sessionId);
    formData.set('exerciseOrder', String(exerciseOrder));
    formData.set('type', isReps ? 'reps' : 'duration');
    formData.set('programSlug', programSlug);
    formData.set('weekNumber', String(weekNumber));
    formData.set('workoutOrder', String(workoutOrder));
    const state = await logSetAction(formData);
    if (!state.ok && state.error.code === 'SESSION_MODIFIED') {
      router.refresh();
    }
    return state;
  }

  const [state, formAction, pending] = useActionState(submitAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 pl-9 pt-2">
      {isReps ? (
        <div>
          <label className="block text-xs text-muted-foreground">Reps</label>
          <input
            name="reps"
            type="number"
            min={1}
            required
            className="w-16 rounded border border-border bg-background px-2 py-1 text-sm"
          />
        </div>
      ) : (
        <div>
          <label className="block text-xs text-muted-foreground">Seconds</label>
          <input
            name="durationSeconds"
            type="number"
            min={1}
            required
            className="w-16 rounded border border-border bg-background px-2 py-1 text-sm"
          />
        </div>
      )}
      <div>
        <label className="block text-xs text-muted-foreground">Weight (kg)</label>
        <input
          name="weightKg"
          type="number"
          min={0}
          step={0.5}
          className="w-16 rounded border border-border bg-background px-2 py-1 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs text-muted-foreground">RPE</label>
        <input
          name="rpe"
          type="number"
          min={1}
          max={10}
          className="w-14 rounded border border-border bg-background px-2 py-1 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? '...' : 'Add set'}
      </button>
      {!state.ok && <SessionActionError error={state.error} className="w-full" />}
    </form>
  );
}
