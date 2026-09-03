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
 * There is exactly ONE weightUnit radio group in the DOM. The parent renders
 * this component's two cells into a responsive grid: on mobile the unit
 * segment sits inline next to the field (bottom-aligned with the input); on
 * desktop it becomes the dedicated "Unit" column (top-aligned label, like
 * Height/Current weight). No duplicated controls at either breakpoint.
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
}

function UnitSegment({ unit, onSelect }: UnitSegmentProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Weight unit"
      className="flex h-[52px] w-full gap-1 rounded-control bg-surface-2 p-1"
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
      <div className="space-y-2">
        <Label htmlFor="weightValue">Current weight</Label>
        <div className="relative">
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
        <ProfileFieldErrors id={errorId} messages={errors} />
      </div>

      <div>
        <span className="hidden text-sm font-medium text-foreground md:block">Unit</span>
        <UnitSegment unit={unit} onSelect={setUnit} />
      </div>
    </>
  );
}
