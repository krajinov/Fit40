import { cn } from '@/lib/utils';

interface EditFieldProps {
  readonly id: string;
  readonly label: string;
  readonly name: string;
  readonly type: 'number';
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly required?: boolean;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

/** One labeled, controlled inline edit input. */
export function EditField({
  id,
  label,
  name,
  min,
  max,
  step,
  required,
  type,
  value,
  onChange,
}: EditFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] font-medium text-ink-2">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        min={min}
        max={max}
        step={step}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'h-10 w-full rounded-[10px] border border-border-strong bg-card px-2.5 text-sm text-foreground',
          'outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
        )}
      />
    </div>
  );
}
