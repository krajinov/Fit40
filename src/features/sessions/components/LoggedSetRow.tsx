'use client';

import { useActionState, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Pencil, Trash2 } from 'lucide-react';

import { EditField } from '@/features/sessions/components/LoggedSetEditField';
import type { WorkoutSessionSetDto } from '@/application/dto/workout-session';

import { updateSetAction } from '@/features/sessions/actions/update-set';
import { deleteSetAction } from '@/features/sessions/actions/delete-set';
import { SessionActionError } from '@/features/sessions/components/SessionActionError';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

const initialState: SessionActionState = { ok: true };

interface LoggedSetRowProps {
  readonly sessionId: string;
  /** The set to display/edit/delete. */
  readonly set: WorkoutSessionSetDto;
  readonly exerciseOrder: number;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  readonly isReps: boolean;
  /** Pre-formatted display line ("52.5 kg × 10", "40s") from the view mapper. */
  readonly valueLabel: string;
}

/**
 * One logged set row of the Active Workout screen (locked design): accent
 * check circle, "Set N" and the value line, with Edit/Delete actions.
 * Editing swaps in a small inline form (weight, reps/seconds, optional
 * prefilled RPE); the CONTRACT of update/delete (ownership, optimistic
 * version handling, revalidation) is unchanged from the pre-redesign row.
 * The optional RPE editor is prefilled from the persisted set, so editing
 * never silently wipes stored RPE, and clearing the field clears it
 * deliberately (empty normalizes to null).
 *
 * The edit inputs are CONTROLLED (initialized from the set's own values) for
 * the same reason as the logger: React 19 resets form DOM after the action
 * resolves, and failed edits must preserve the user's corrections.
 */
export function LoggedSetRow({
  sessionId,
  set,
  exerciseOrder,
  programSlug,
  weekNumber,
  workoutOrder,
  isReps,
  valueLabel,
}: LoggedSetRowProps) {
  const router = useRouter();
  const weightId = useId();
  const countId = useId();
  const rpeId = useId();

  const [editing, setEditing] = useState(false);
  // Controlled edit values (initialized from the set's persisted values):
  // React 19 resets form DOM after the action resolves — including error
  // resolutions — so uncontrolled edits would be wiped on a failed save.
  const [editWeight, setEditWeight] = useState(set.weightKg === null ? '' : String(set.weightKg));
  const [editCount, setEditCount] = useState(
    set.type === 'reps' ? String(set.reps) : String(set.durationSeconds),
  );
  const [editRpe, setEditRpe] = useState(set.rpe === null ? '' : String(set.rpe));

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
    // Optional RPE editor: submit the entered value; an empty field
    // normalizes to null so clearing RPE is a deliberate user action.
    if (editRpe !== '') {
      formData.set('rpe', editRpe);
    }
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

  if (editing) {
    return (
      <li className="rounded-[10px] bg-background px-3 py-2.5 md:rounded-xl md:px-4 md:py-3">
        <form action={updateFormAction} className="flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-2">
            <EditField
              id={weightId}
              label="Weight (kg)"
              name="weightKg"
              type="number"
              min={0}
              step={0.5}
              value={editWeight}
              onChange={setEditWeight}
            />
            <EditField
              id={countId}
              label={isReps ? 'Reps' : 'Seconds'}
              name={isReps ? 'reps' : 'durationSeconds'}
              type="number"
              min={1}
              required
              value={editCount}
              onChange={setEditCount}
            />
            <EditField
              id={rpeId}
              label="RPE (optional)"
              name="rpe"
              type="number"
              min={1}
              max={10}
              step={1}
              value={editRpe}
              onChange={setEditRpe}
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={updatePending}
              className="text-xs font-semibold text-primary hover:underline disabled:opacity-50"
            >
              {updatePending ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-xs font-medium text-ink-3 hover:text-ink-2"
            >
              Cancel
            </button>
          </div>
        </form>
        {!updateState.ok && <SessionActionError error={updateState.error} className="mt-1.5" />}
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 rounded-[10px] bg-background px-3 py-2.5 md:gap-3.5 md:rounded-xl md:px-4 md:py-3">
      <span
        aria-hidden="true"
        className="flex size-[18px] shrink-0 items-center justify-center rounded-pill bg-primary text-primary-foreground md:size-[22px]"
      >
        <Check className="size-[11px] md:size-[13px]" />
      </span>
      <span className="w-14 shrink-0 text-[13px] font-medium text-ink-3 md:text-sm">
        Set {set.setNumber}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink md:text-[15px]">
        {valueLabel}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit set ${set.setNumber}`}
          className="rounded-md p-1.5 text-ink-3 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Pencil aria-hidden="true" className="size-4" />
        </button>
        <form action={deleteFormAction}>
          <button
            type="submit"
            disabled={deletePending}
            aria-label={`Delete set ${set.setNumber}`}
            className="rounded-md p-1.5 text-ink-3 transition-colors hover:text-destructive disabled:opacity-50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </button>
        </form>
      </span>
      {!updateState.ok && <SessionActionError error={updateState.error} className="w-full" />}
      {!deleteState.ok && <SessionActionError error={deleteState.error} className="w-full" />}
    </li>
  );
}
