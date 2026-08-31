import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

import { ProfileFieldErrors } from '@/features/profile/components/ProfileFieldErrors';

/**
 * Labelled text input with an in-field unit suffix (locked design: h52 field,
 * Inter 15 unit in ink-3). Server-renderable - no client state.
 */
export interface ProfileUnitInputProps {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly defaultValue: string;
  readonly placeholder?: string;
  readonly inputMode?: 'numeric' | 'decimal';
  readonly autoComplete?: string;
  readonly unit?: string;
  readonly errors?: ReadonlyArray<string>;
  readonly className?: string;
}

export function ProfileUnitInput({
  id,
  name,
  label,
  defaultValue,
  placeholder,
  inputMode,
  autoComplete,
  unit,
  errors,
  className,
}: ProfileUnitInputProps) {
  const errorId = `${id}-error`;
  const hasErrors = errors !== undefined && errors.length > 0;

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type="text"
          inputMode={inputMode}
          autoComplete={autoComplete}
          placeholder={placeholder}
          defaultValue={defaultValue}
          aria-invalid={hasErrors || undefined}
          aria-describedby={hasErrors ? errorId : undefined}
          className={unit === undefined ? undefined : 'pr-14'}
        />
        {unit !== undefined && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-[15px] font-medium text-ink-3"
          >
            {unit}
          </span>
        )}
      </div>
      <ProfileFieldErrors id={errorId} messages={errors} />
    </div>
  );
}
