'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import type { WorkoutSessionSetDto } from '@/application/dto/workout-session';

import { updateSetAction } from '@/features/sessions/actions/update-set';
import { deleteSetAction } from '@/features/sessions/actions/delete-set';
import { SessionActionError } from '@/features/sessions/components/SessionActionError';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

const initialState: SessionActionState = { ok: true };

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
  const router = useRouter();

  async function updateAction(
    prev: SessionActionState,
    formData: FormData,
  ): Promise<SessionActionState> {
    formData.set('sessionId', sessionId);
    formData.set('exerciseOrder', String(exerciseOrder));
    formData.set('setNumber', String(set.setNumber));
    formData.set('type', isReps ? 'reps' : 'duration');
    formData.set('programSlug', programSlug);
    formData.set('weekNumber', String(weekNumber));
    formData.set('workoutOrder', String(workoutOrder));
    const state = await updateSetAction(formData);
    if (!state.ok && state.error.code === 'SESSION_MODIFIED') {
      router.refresh();
    }
    return state;
  }

  async function removeAction(
    prev: SessionActionState,
    formData: FormData,
  ): Promise<SessionActionState> {
    formData.set('sessionId', sessionId);
    formData.set('exerciseOrder', String(exerciseOrder));
    formData.set('setNumber', String(set.setNumber));
    formData.set('programSlug', programSlug);
    formData.set('weekNumber', String(weekNumber));
    formData.set('workoutOrder', String(workoutOrder));
    const state = await deleteSetAction(formData);
    if (!state.ok && state.error.code === 'SESSION_MODIFIED') {
      router.refresh();
    }
    return state;
  }

  const [updateState, updateFormAction, updatePending] = useActionState(updateAction, initialState);
  const [deleteState, deleteFormAction, deletePending] = useActionState(removeAction, initialState);

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

      {!updateState.ok && <SessionActionError error={updateState.error} className="w-full" />}
      {!deleteState.ok && <SessionActionError error={deleteState.error} className="w-full" />}
    </li>
  );
}
