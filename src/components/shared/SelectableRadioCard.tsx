import type { ChangeEvent } from 'react';

import { cn } from '@/lib/utils';

/**
 * Selectable radio option card (locked design): h56, radius 12, radio
 * semantics with a 20px indicator circle and 10px selected dot.
 *
 * Built on a native radio input, so arrow-key navigation between options of
 * the same `name` and form submission work with zero client JavaScript.
 */
export interface SelectableRadioCardProps {
  readonly name: string;
  readonly value: string;
  readonly label: string;
  /** Optional muted secondary line under the label (e.g. "Dumbbell · Chest"). */
  readonly hint?: string;
  readonly defaultChecked?: boolean;
  /**
   * Controlled selection. Omit for the uncontrolled (`defaultChecked`) usage;
   * when provided, `onChange` must be provided too.
   */
  readonly checked?: boolean;
  readonly onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  /** Native required flag; one required radio satisfies the whole group. */
  readonly required?: boolean;
  readonly className?: string;
}

export function SelectableRadioCard({
  name,
  value,
  label,
  hint,
  defaultChecked,
  checked,
  onChange,
  required,
  className,
}: SelectableRadioCardProps) {
  return (
    <label
      className={cn(
        'group/radio flex min-h-14 cursor-pointer items-center gap-3 rounded-control border border-border-strong bg-card px-[18px] py-2 text-[15px] text-foreground transition-colors select-none',
        'hover:border-ink-3',
        'has-checked:border-primary has-checked:bg-accent-tint',
        'has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
        className,
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        checked={checked}
        onChange={onChange}
        required={required}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className="flex size-5 shrink-0 items-center justify-center rounded-pill border border-border-strong bg-card transition-colors group-has-checked/radio:border-primary"
      >
        <span className="size-2.5 scale-0 rounded-pill bg-primary transition-transform group-has-checked/radio:scale-100" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {hint !== undefined && (
          <span className="mt-0.5 block text-[13px] font-normal text-ink-3">{hint}</span>
        )}
      </span>
    </label>
  );
}
