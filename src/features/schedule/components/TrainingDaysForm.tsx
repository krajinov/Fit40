'use client';

import { useActionState, useState } from 'react';

import { Chip } from '@/components/shared/Chip';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { configureTrainingDaysAction } from '@/features/schedule/actions/configure-training-days';
import { ScheduleActionError } from '@/features/schedule/components/ScheduleActionError';
import type { ScheduleActionState } from '@/features/schedule/types/schedule-action-state';

const initialState: ScheduleActionState = { ok: true };

/** ISO weekday options: Monday = 1 … Sunday = 7. */
const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
] as const;

/**
 * The approved change-mode pointer: M15 stores concrete planned dates, not a
 * weekday preference, so the selection is presented as a fresh replacement
 * rather than as a persisted setting.
 */
export const CHANGE_TRAINING_DAYS_COPY =
  'Choose a new weekly pattern. Saving replaces the dates of future workouts; completed workouts stay in history and in-progress workouts keep their current date.';

interface TrainingDaysFormProps {
  readonly programSlug: string;
  /** `setup` when the run has no planning yet, `change` to regenerate it. */
  readonly mode: 'setup' | 'change';
  readonly className?: string;
}

/**
 * Training-days configuration form (M15 Slice 7): seven keyboard-operable
 * weekday chips and one submit. Client-side state exists only to keep the
 * selection deterministic across a failed save (Chip's controlled mode).
 *
 * The selection is deliberately a FRESH choice in both modes — M15 persists
 * planned dates, not weekdays, so no day is pre-checked and nothing here
 * claims to represent a stored preference. The program slug is injected from
 * the server-rendered prop, so the form submits only `weekday` values and no
 * enrollment or user id can travel in the form data.
 */
export function TrainingDaysForm({ programSlug, mode, className }: TrainingDaysFormProps) {
  const [selected, setSelected] = useState<ReadonlyArray<number>>([]);
  // React resets a native <form action={…}> after every submission, which
  // clears the DOM checked state of uncontrolled inputs. Re-mounting the chips
  // after each attempt makes React re-apply the selection it still holds, so a
  // failed save never silently drops what the user chose.
  const [attempt, setAttempt] = useState(0);

  async function submitAction(
    _prev: ScheduleActionState,
    formData: FormData,
  ): Promise<ScheduleActionState> {
    formData.set('programSlug', programSlug);
    const next = await configureTrainingDaysAction(formData);
    setAttempt((current) => current + 1);
    return next;
  }

  const [state, formAction, pending] = useActionState(submitAction, initialState);

  return (
    <form action={formAction} className={cn('flex flex-col gap-3', className)}>
      {mode === 'change' && (
        <p className="max-w-lg text-[13px] text-ink-3">{CHANGE_TRAINING_DAYS_COPY}</p>
      )}

      <fieldset className="flex flex-col gap-2.5">
        <legend className="text-sm font-medium text-foreground">Training days</legend>
        <div className="flex flex-wrap gap-2 md:gap-2.5">
          {WEEKDAY_OPTIONS.map((option) => (
            <Chip
              key={`${option.value}-${attempt}`}
              name="weekday"
              value={String(option.value)}
              label={option.label}
              checked={selected.includes(option.value)}
              onCheckedChange={(checked) =>
                setSelected((current) =>
                  checked
                    ? [...current, option.value]
                    : current.filter((value) => value !== option.value),
                )
              }
            />
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col items-start gap-2">
        <button
          type="submit"
          disabled={pending}
          className={cn(buttonVariants(), 'w-full md:w-auto')}
        >
          {pending ? 'Saving…' : mode === 'setup' ? 'Set training days' : 'Save training days'}
        </button>
        {!state.ok && <ScheduleActionError error={state.error} />}
      </div>
    </form>
  );
}