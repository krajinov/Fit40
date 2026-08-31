'use client';

import { useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

import { ProfileFieldErrors } from '@/features/profile/components/ProfileFieldErrors';
import { WEIGHT_UNITS } from '@/features/profile/schemas/profile-schemas';

/**
 * Current-weight field with the kg/lb unit toggle (locked design).
 *
 * Presentation-only unit handling: the ENTERED VALUE is never converted or
 * rounded on the client (no drift). The selected unit travels to the server
 * as the `weightUnit` form field and the server action performs the
 * canonical lb->kg conversion, exactly as before the redesign.
 *
 * The design places the segmented unit control inline next to the field on
 * mobile and in its own "Unit" column on desktop. Both segments are the same
 * radio group (name="weightUnit") driven by one piece of selection state;
 * the hidden breakpoint's radios submit the identical checked value, and the
 * action reads a single value with FormData.get.
 */
export interface ProfileWeightFieldProps {
  readonly weightValue: string;
  readonly weightUnit: string;
  readonly errors?: ReadonlyArray<string>;
}

const OPTION_CLASSES = cn(
  'flex h-11 flex-1 cursor-pointer items-center justify-center rounded-[9px] text-[15px] font-medium text-ink-2 transition-colors select-none',
  'hover:text-foreground',
  'has-checked:bg-primary has-checked:font-semibold has-checked:text-primary-foreground',
  'has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
);

interface UnitSegmentProps {
  readonly unit: 'kg' | 'lb';
  readonly onSelect: (unit: 'kg' | 'lb') => void;
  readonly className?: string;
}

function UnitSegment({ unit, onSelect, className }: UnitSegmentProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Weight unit"
      className={cn('flex gap-1 rounded-control bg-surface-2 p-1', className)}
    >
      {WEIGHT_UNITS.map((u) => (
        <label key={u} className={OPTION_CLASSES}>
          <input
            type="radio"
            name="weightUnit"
            value={u}
            checked={unit === u}
            onChange={() => onSelect(u)}
            className="sr-only"
          />
          {u}
        </label>
      ))}
    </div>
  );
}

export function ProfileWeightField({ weightValue, weightUnit, errors }: ProfileWeightFieldProps) {
  const [unit, setUnit] = useState<'kg' | 'lb'>(weightUnit === 'lb' ? 'lb' : 'kg');
  const errorId = 'weight-error';
  const hasErrors = errors !== undefined && errors.length > 0;

  return (
    <>
      <div className="space-y-2 md:w-[280px]">
        <Label htmlFor="weightValue">Current weight</Label>
        <div className="flex items-stretch gap-2.5">
          <div className="relative flex-1">
            <Input
              id="weightValue"
              name="weightValue"
              type="text"
              inputMode="decimal"
              placeholder={unit === 'lb' ? 'e.g. 176' : 'e.g. 80'}
              defaultValue={weightValue}
              aria-invalid={hasErrors || undefined}
              aria-describedby={hasErrors ? errorId : undefined}
              className="md:pr-14"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-4 hidden -translate-y-1/2 text-[15px] font-medium text-ink-3 md:block"
            >
              {unit}
            </span>
          </div>
          {/* Mobile: unit segment sits inline next to the field. */}
          <UnitSegment unit={unit} onSelect={setUnit} className="w-[120px] shrink-0 md:hidden" />
        </div>
        <ProfileFieldErrors id={errorId} messages={errors} />
      </div>

      {/* Desktop: dedicated "Unit" column aligned with the field row. */}
      <div className="hidden space-y-2 md:block md:w-[180px]">
        <span className="block text-sm font-medium text-foreground">Unit</span>
        <UnitSegment unit={unit} onSelect={setUnit} />
      </div>
    </>
  );
}
