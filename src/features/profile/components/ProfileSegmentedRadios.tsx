import { cn } from '@/lib/utils';

import { ProfileFieldErrors } from '@/features/profile/components/ProfileFieldErrors';

/**
 * Compact segmented radio group used by the profile forms for training days,
 * session length and (inside ProfileWeightField) the weight unit.
 *
 * Profile-local presentation on NATIVE radio inputs: arrow-key navigation,
 * form participation and checked state all work with zero client JavaScript
 * (:has(:checked) styling). Intentionally not a generic design-system
 * primitive - the locked design only needs it here.
 */
export interface SegmentedOption {
  readonly value: string;
  readonly label: string;
}

export interface ProfileSegmentedRadiosProps {
  readonly name: string;
  readonly legend: string;
  readonly options: ReadonlyArray<SegmentedOption>;
  readonly defaultValue: string;
  readonly errors?: ReadonlyArray<string>;
  readonly className?: string;
}

export function ProfileSegmentedRadios({
  name,
  legend,
  options,
  defaultValue,
  errors,
  className,
}: ProfileSegmentedRadiosProps) {
  const errorId = `${name}-error`;
  const hasErrors = errors !== undefined && errors.length > 0;

  return (
    <fieldset aria-describedby={hasErrors ? errorId : undefined} className={className}>
      <legend className="mb-3 block text-sm font-medium text-foreground">{legend}</legend>
      <div className="flex gap-1 rounded-control bg-surface-2 p-1">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex h-11 flex-1 cursor-pointer items-center justify-center rounded-[9px] text-[15px] font-medium text-ink-2 transition-colors select-none',
              'hover:text-foreground',
              'has-checked:bg-primary has-checked:font-semibold has-checked:text-primary-foreground',
              'has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              defaultChecked={defaultValue === option.value}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
      <ProfileFieldErrors id={errorId} messages={errors} />
    </fieldset>
  );
}
