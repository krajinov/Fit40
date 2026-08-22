'use client';

import { useActionState } from 'react';
import type { WorkoutSessionSetDto } from '@/application/dto/workout-session';

import { updateSetAction } from '@/features/sessions/actions/update-set';
import { deleteSetAction } from '@/features/sessions/actions/delete-set';

interface LoggedSetRowProps {
  readonly sessionId: string;
  readonly set: WorkoutSessionSetDto;
  readonly exerciseOrder: number;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  readonly isReps: boolean;
}

export function LoggedSetRow({
  sessionId,
  set,
  exerciseOrder,
  programSlug,
  weekNumber,
  workoutOrder,
  isReps,
}: LoggedSetRowProps) {
  async function updateAction(prev: string | undefined, formData: FormData) {
    formData.set('sessionId', sessionId);
    formData.set('exerciseOrder', String(exerciseOrder));
    formData.set('setNumber', String(set.setNumber));
    formData.set('type', isReps ? 'reps' : 'duration');
    formData.set('programSlug', programSlug);
    formData.set('weekNumber', String(weekNumber));
    formData.set('workoutOrder', String(workoutOrder));
    await updateSetAction(formData);
    return undefined;
  }

  async function removeAction(prev: string | undefined, formData: FormData) {
    formData.set('sessionId', sessionId);
    formData.set('exerciseOrder', String(exerciseOrder));
    formData.set('setNumber', String(set.setNumber));
    formData.set('programSlug', programSlug);
    formData.set('weekNumber', String(weekNumber));
    formData.set('workoutOrder', String(workoutOrder));
    await deleteSetAction(formData);
    return undefined;
  }

  const [, updateFormAction, updatePending] = useActionState(updateAction, undefined);
  const [, deleteFormAction, deletePending] = useActionState(removeAction, undefined);

  return (
    <li className="flex flex-wrap items-center gap-2 text-sm py-1">
      <span className="text-muted-foreground">Set {set.setNumber}:</span>

      {set.type === 'reps' ? (
        <>
          <span>
            {set.reps} reps
            {set.weightKg !== null ? ` x ${set.weightKg} kg` : ''}
            {set.rpe !== null ? ` @ RPE ${set.rpe}` : ''}
          </span>

          <form action={updateFormAction} className="flex items-center gap-1 ml-auto">
            <input name="reps" type="number" min={1} defaultValue={set.reps} className="w-12 rounded border border-border bg-background px-1 py-0.5 text-xs" />
            {set.type === 'reps' && (
              <input name="weightKg" type="number" min={0} step={0.5} defaultValue={set.weightKg ?? ''} className="w-14 rounded border border-border bg-background px-1 py-0.5 text-xs" />
            )}
            <button type="submit" disabled={updatePending} className="text-xs text-primary hover:underline disabled:opacity-50">
              Save
            </button>
          </form>
        </>
      ) : (
        <>
          <span>
            {set.durationSeconds}s
            {set.weightKg !== null ? ` x ${set.weightKg} kg` : ''}
            {set.rpe !== null ? ` @ RPE ${set.rpe}` : ''}
          </span>
        </>
      )}

      <form action={deleteFormAction} className="inline">
        <button type="submit" disabled={deletePending} className="text-xs text-destructive hover:underline disabled:opacity-50">
          Delete
        </button>
      </form>
    </li>
  );
}