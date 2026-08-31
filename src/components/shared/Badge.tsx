import { cva, type VariantProps } from 'class-variance-authority';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Badge (locked design): h28 pill, Inter 13.
 * - neutral: surface-2 fill, ink-2 text
 * - accent:  accent-tint fill + accent-tint border, accent-strong text
 * - done:    accent-tint fill with a check icon
 */
const badgeVariants = cva(
  'inline-flex h-7 items-center gap-1.5 rounded-pill px-3 text-[13px] whitespace-nowrap',
  {
    variants: {
      variant: {
        neutral: 'bg-surface-2 font-medium text-ink-2',
        accent: 'border border-accent-tint-border bg-accent-tint font-semibold text-accent-strong',
        done: 'bg-accent-tint font-semibold text-accent-strong',
      },
    },
    defaultVariants: {
      variant: 'neutral',
    },
  },
);

export interface BadgeProps extends VariantProps<typeof badgeVariants> {
  readonly children: ReactNode;
  readonly className?: string;
}

export function Badge({ variant, children, className }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)}>
      {variant === 'done' && <Check aria-hidden="true" className="size-3.5" />}
      {children}
    </span>
  );
}
