'use client';

import { useActionState } from 'react';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

import { logSetAction } from '@/features/sessions/actions/log-set';

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
  const isReps = prescription.type === 'reps';

  async function submitAction(prev: string | undefined, formData: FormData) {
    formData.set('sessionId', sessionId);
    formData.set('exerciseOrder', String(exerciseOrder));
    formData.set('type', isReps ? 'reps' : 'duration');
    formData.set('programSlug', programSlug);
    formData.set('weekNumber', String(weekNumber));
    formData.set('workoutOrder', String(workoutOrder));
    await logSetAction(formData);
    return undefined;
  }

  const [, formAction, pending] = useActionState(submitAction, undefined);

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
    </form>
  );
}