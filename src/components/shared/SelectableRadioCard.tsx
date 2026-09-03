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
  readonly defaultChecked?: boolean;
  readonly className?: string;
}

export function SelectableRadioCard({
  name,
  value,
  label,
  defaultChecked,
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
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className="flex size-5 shrink-0 items-center justify-center rounded-pill border border-border-strong bg-card transition-colors group-has-checked/radio:border-primary"
      >
        <span className="size-2.5 scale-0 rounded-pill bg-primary transition-transform group-has-checked/radio:scale-100" />
      </span>
      <span>{label}</span>
    </label>
  );
}
