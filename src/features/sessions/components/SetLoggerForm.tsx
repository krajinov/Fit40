'use client';

import { useActionState, useId, useState } from 'react';
import { useRouter } from 'next/navigation';

import { RecommendationCallout } from '@/components/shared/RecommendationCallout';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

import { logSetAction } from '@/features/sessions/actions/log-set';
import type { SessionCalloutView } from '@/features/sessions/active-workout-logger-views';
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
  /**
   * Weight prefill (latest session load → recommendation → null), resolved
   * server-side. Applied ONCE on mount: the parent remounts this form (key =
   * order + set count + latest weight) whenever the session data actually
   * changes, and deliberately keeps it mounted on failed submits so the
   * user's typed values survive.
   */
  readonly prefillWeightKg: number | null;
  /** Advisory recommendation callout; null renders no callout. */
  readonly callout: SessionCalloutView | null;
}

/**
 * Set logger (locked design): Weight (kg) · Reps/Seconds · "Log set" primary
 * action, plus the advisory recommendation callout beside the fields
 * (desktop) / above them (mobile). The locked Active Workout design has NO
 * RPE input, so none is rendered; the schema keeps RPE optional and it is
 * simply not collected here (submitted as unset → null).
 *
 * The inputs are CONTROLLED, not uncontrolled: React 19 resets a form's DOM
 * after its action resolves — including error resolutions — which would wipe
 * uncontrolled values on a failed submit. Controlled state keeps the user's
 * typing across failures while the parent's remount key refreshes the prefill
 * exactly when the underlying session data changes.
 */
export function SetLoggerForm({
  sessionId,
  exerciseOrder,
  prescription,
  programSlug,
  weekNumber,
  workoutOrder,
  prefillWeightKg,
  callout,
}: SetLoggerFormProps) {
  const router = useRouter();
  const isReps = prescription.type === 'reps';
  const weightId = useId();
  const countId = useId();

  const [weight, setWeight] = useState(prefillWeightKg === null ? '' : String(prefillWeightKg));
  const [count, setCount] = useState('');

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
    // The locked design has no RPE input; '' normalizes to null (optional).
    formData.set('rpe', '');
    const state = await logSetAction(formData);
    if (!state.ok && state.error.code === 'SESSION_MODIFIED') {
      router.refresh();
    }
    return state;
  }

  const [state, formAction, pending] = useActionState(submitAction, initialState);

  const fieldClass = 'h-12 rounded-[10px] md:h-[52px] md:rounded-control';

  return (
    <form action={formAction} className="flex flex-col gap-3 md:flex-row md:items-stretch md:gap-5">
      {callout !== null && (
        <div className="shrink-0 md:w-[300px]">
          <RecommendationCallout
            kind={callout.kind}
            valueLabel={callout.valueLabel}
            contextLabel={callout.contextLabel}
          />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="grid grid-cols-2 gap-2 md:flex md:items-end md:gap-3">
          <div>
            <label
              htmlFor={weightId}
              className="mb-1.5 block text-[11px] font-medium text-ink-2 md:text-[13px]"
            >
              <span className="md:hidden">Weight</span>
              <span className="hidden md:inline">Weight (kg)</span>
            </label>
            <div className="relative">
              <Input
                id={weightId}
                name="weightKg"
                type="number"
                min={0}
                step={0.5}
                inputMode="decimal"
                value={weight}
                onChange={(event) => setWeight(event.target.value)}
                aria-label="Weight in kilograms"
                className={cn(fieldClass, 'pr-9')}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs font-medium text-ink-3 md:text-sm"
              >
                kg
              </span>
            </div>
          </div>

          <div>
            <label
              htmlFor={countId}
              className="mb-1.5 block text-[11px] font-medium text-ink-2 md:text-[13px]"
            >
              {isReps ? 'Reps' : 'Seconds'}
            </label>
            <Input
              id={countId}
              name={isReps ? 'reps' : 'durationSeconds'}
              type="number"
              min={1}
              required
              inputMode="numeric"
              value={count}
              onChange={(event) => setCount(event.target.value)}
              className={fieldClass}
            />
          </div>

          <button
            type="submit"
            disabled={pending}
            className={cn(
              buttonVariants(),
              'col-span-2 h-12 rounded-[10px] md:col-span-1 md:h-auto md:w-auto',
            )}
          >
            {pending ? 'Logging…' : 'Log set'}
          </button>
        </div>

        {!state.ok && <SessionActionError error={state.error} className="mt-2" />}
      </div>
    </form>
  );
}
