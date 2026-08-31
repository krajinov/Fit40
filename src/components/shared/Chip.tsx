import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Selectable filter chip (locked design): h48, radius 12, checkbox semantics.
 *
 * Built on a native checkbox so it participates in regular <form> submissions
 * (including GET filter forms), needs zero client JavaScript, and keeps full
 * keyboard/screen-reader support. Selection styling uses :has(:checked).
 */
export interface ChipProps {
  readonly name: string;
  readonly value: string;
  readonly label: string;
  readonly defaultChecked?: boolean;
  readonly className?: string;
}

export function Chip({ name, value, label, defaultChecked, className }: ChipProps) {
  return (
    <label
      className={cn(
        'group/chip flex h-12 cursor-pointer items-center gap-2.5 rounded-control border border-border-strong bg-card px-4 text-[15px] text-foreground transition-colors select-none',
        'hover:border-ink-3',
        'has-checked:border-primary has-checked:bg-accent-tint',
        'has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
        className,
      )}
    >
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border border-border-strong bg-card transition-colors group-has-checked/chip:border-primary group-has-checked/chip:bg-primary"
      >
        <Check className="size-3 text-primary-foreground opacity-0 transition-opacity group-has-checked/chip:opacity-100" />
      </span>
      <span className="group-has-checked/chip:font-medium">{label}</span>
    </label>
  );
}
