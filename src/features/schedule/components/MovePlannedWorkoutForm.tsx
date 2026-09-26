'use client';

import { useActionState } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { reschedulePlannedWorkoutAction } from '@/features/schedule/actions/reschedule-planned-workout';
import { ScheduleActionError } from '@/features/schedule/components/ScheduleActionError';
import type { ScheduleActionState } from '@/features/schedule/types/schedule-action-state';

const initialState: ScheduleActionState = { ok: true };

interface MovePlannedWorkoutFormProps {
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  /** The workout's current canonical planned date: context and input default. */
  readonly plannedDate: string;
  readonly workoutName: string;
  readonly className?: string;
}

/**
 * Move affordance for one never-started planned workout (M15 Slice 7): a
 * native disclosure with a canonical-date input and one submit.
 *
 * The date input is a plain `type="date"` field: the browser submits the
 * canonical `YYYY-MM-DD` string directly, so presentation never converts it
 * through a JavaScript `Date` (which is exactly the timezone-sensitive
 * conversion M15's domain avoids). The authored public coordinates (slug,
 * week number, workout order) are injected from the server-rendered props, so
 * the form submits only the date and no enrollment id, database id, session id
 * or user id can travel in the form data — and no eligibility decision is made
 * here: the use case rejects completed, in-progress, occupied and past targets.
 *
 * The label names the workout so the control stays identifiable even though it
 * lives inside the workout's own calendar cell.
 */
export function MovePlannedWorkoutForm({
  programSlug,
  weekNumber,
  workoutOrder,
  plannedDate,
  workoutName,
  className,
}: MovePlannedWorkoutFormProps) {
  const inputId = `move-date-${weekNumber}-${workoutOrder}`;

  async function submitAction(
    _prev: ScheduleActionState,
    formData: FormData,
  ): Promise<ScheduleActionState> {
    formData.set('programSlug', programSlug);
    formData.set('weekNumber', String(weekNumber));
    formData.set('workoutOrder', String(workoutOrder));
    return reschedulePlannedWorkoutAction(formData);
  }

  const [state, formAction, pending] = useActionState(submitAction, initialState);

  return (
    <details className={cn('group/move', className)}>
      <summary className="inline-flex h-11 cursor-pointer items-center rounded-control px-2 text-[13px] font-medium text-accent-strong underline-offset-2 select-none hover:underline focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
        Move
      </summary>
      <form action={formAction} className="mt-2 flex flex-col gap-2">
        <Label htmlFor={inputId} className="text-[13px]">
          New date for {workoutName}
        </Label>
        <Input
          id={inputId}
          type="date"
          name="date"
          defaultValue={plannedDate}
          required
          className="h-11 px-3 text-[15px]"
        />
        <button
          type="submit"
          disabled={pending}
          className={cn(buttonVariants({ variant: 'secondary' }), 'w-full')}
        >
          {pending ? 'Moving…' : 'Move workout'}
        </button>
        {!state.ok && <ScheduleActionError error={state.error} />}
      </form>
    </details>
  );
}