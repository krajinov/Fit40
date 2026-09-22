'use client';

import { useId } from 'react';

import { SelectableRadioCard } from '@/components/shared/SelectableRadioCard';
import { Input } from '@/components/ui/input';
import type { AddExerciseScheme } from '@/features/sessions/add-exercise-draft';

interface AddExercisePrescriptionFieldsProps {
  /** Current scheme from the parent-owned Add draft (`null` = not chosen yet). */
  readonly scheme: AddExerciseScheme | null;
  /** Current sets text from the parent-owned Add draft. */
  readonly sets: string;
  /** Current target reps text from the parent-owned Add draft. */
  readonly targetReps: string;
  /** Current seconds text from the parent-owned Add draft. */
  readonly durationSeconds: string;
  readonly onSchemeChange: (scheme: AddExerciseScheme) => void;
  readonly onSetsChange: (sets: string) => void;
  readonly onTargetRepsChange: (targetReps: string) => void;
  readonly onDurationSecondsChange: (durationSeconds: string) => void;
}

const fieldClass = 'h-12 rounded-[10px] md:h-[52px] md:rounded-control';

/**
 * The EXPLICIT prescription inputs of the Add Exercise form (M11).
 *
 * Presentational only: every value and change callback comes from the
 * parent-owned Add draft (`add-exercise-draft.ts`), so prescription state can
 * never diverge from the exercise selection — the whole draft is preserved on
 * an expected failure and cleared as one unit on success (PR #14 review
 * finding). The inputs are controlled rather than DOM-owned for the same
 * reason `SetLoggerForm` is: React 19 resets a form's DOM after its action
 * resolves, including error resolutions.
 *
 * The user must choose the scheme before any numeric field appears, and every
 * field starts EMPTY: there is no default prescription (no "3x10"), no catalog
 * default and no AI recommendation. `minReps = maxReps = targetReps` and the
 * rest snapshot stay server/domain rules — nothing about them is exposed here.
 */
export function AddExercisePrescriptionFields({
  scheme,
  sets,
  targetReps,
  durationSeconds,
  onSchemeChange,
  onSetsChange,
  onTargetRepsChange,
  onDurationSecondsChange,
}: AddExercisePrescriptionFieldsProps) {
  const setsId = useId();
  const targetId = useId();

  return (
    <div className="flex flex-col gap-3">
      <fieldset>
        <legend className="mb-1.5 block text-[11px] font-medium text-ink-2 md:text-[13px]">
          Prescription
        </legend>
        <div className="flex flex-col gap-2 md:flex-row">
          <SelectableRadioCard
            name="scheme"
            value="reps"
            label="Reps"
            checked={scheme === 'reps'}
            onChange={() => onSchemeChange('reps')}
            className="md:flex-1"
          />
          <SelectableRadioCard
            name="scheme"
            value="duration"
            label="Duration"
            checked={scheme === 'duration'}
            onChange={() => onSchemeChange('duration')}
            className="md:flex-1"
          />
        </div>
      </fieldset>

      {scheme !== null && (
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:gap-3">
          <div className="md:w-32">
            <label
              htmlFor={setsId}
              className="mb-1.5 block text-[11px] font-medium text-ink-2 md:text-[13px]"
            >
              Sets
            </label>
            <Input
              id={setsId}
              name="sets"
              type="number"
              min={1}
              step={1}
              required
              inputMode="numeric"
              value={sets}
              onChange={(event) => onSetsChange(event.target.value)}
              className={fieldClass}
            />
          </div>

          <div className="md:w-44">
            <label
              htmlFor={targetId}
              className="mb-1.5 block text-[11px] font-medium text-ink-2 md:text-[13px]"
            >
              {scheme === 'reps' ? 'Target reps' : 'Seconds'}
            </label>
            {scheme === 'reps' ? (
              <Input
                id={targetId}
                name="targetReps"
                type="number"
                min={1}
                step={1}
                required
                inputMode="numeric"
                value={targetReps}
                onChange={(event) => onTargetRepsChange(event.target.value)}
                className={fieldClass}
              />
            ) : (
              <Input
                id={targetId}
                name="durationSeconds"
                type="number"
                min={1}
                step={1}
                required
                inputMode="numeric"
                value={durationSeconds}
                onChange={(event) => onDurationSecondsChange(event.target.value)}
                className={fieldClass}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
