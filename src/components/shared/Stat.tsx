import { cn } from '@/lib/utils';

/**
 * Stat display (locked design): Sora 30/600 value above an Inter 13/500 label.
 */
export interface StatProps {
  readonly value: string;
  readonly label: string;
  readonly className?: string;
}

export function Stat({ value, label, className }: StatProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <p className="font-display text-[30px] leading-9 font-semibold text-foreground">{value}</p>
      <p className="text-[13px] font-medium text-ink-2">{label}</p>
    </div>
  );
}
