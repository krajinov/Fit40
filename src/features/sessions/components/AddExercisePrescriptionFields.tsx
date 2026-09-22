'use client';

import { useId, useState } from 'react';

import { SelectableRadioCard } from '@/components/shared/SelectableRadioCard';
import { Input } from '@/components/ui/input';

/** The two explicit prescription schemes a session-added occurrence supports. */
export type AddExerciseScheme = 'reps' | 'duration';

const fieldClass = 'h-12 rounded-[10px] md:h-[52px] md:rounded-control';

/**
 * The EXPLICIT prescription inputs of the Add Exercise form (M11).
 *
 * The user must choose the scheme before any numeric field appears, and every
 * field starts EMPTY: there is no default prescription (no "3x10"), no catalog
 * default and no AI recommendation. `minReps = maxReps = targetReps` and the
 * rest snapshot stay server/domain rules — nothing about them is exposed here.
 *
 * The inputs are controlled so React 19's post-action form reset cannot wipe
 * the user's typed values on a failed submit (the same reason `SetLoggerForm`
 * is controlled). State is component-local; nothing is persisted.
 */
export function AddExercisePrescriptionFields() {
  const [scheme, setScheme] = useState<AddExerciseScheme | null>(null);
  const [sets, setSets] = useState('');
  const [targetReps, setTargetReps] = useState('');
  const [durationSeconds, setDurationSeconds] = useState('');
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
            onChange={() => setScheme('reps')}
            className="md:flex-1"
          />
          <SelectableRadioCard
            name="scheme"
            value="duration"
            label="Duration"
            checked={scheme === 'duration'}
            onChange={() => setScheme('duration')}
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
              onChange={(event) => setSets(event.target.value)}
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
                onChange={(event) => setTargetReps(event.target.value)}
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
                onChange={(event) => setDurationSeconds(event.target.value)}
                className={fieldClass}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
