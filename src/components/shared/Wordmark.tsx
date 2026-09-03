import Link from 'next/link';

import { cn } from '@/lib/utils';

/**
 * Fit40 wordmark (locked design): Sora 700, "Fit" in ink + "40" in accent.
 * Links home; font size is overridable (desktop nav 21px, mobile header 20px).
 */
export interface WordmarkProps {
  readonly href?: string;
  readonly className?: string;
}

export function Wordmark({ href = '/dashboard', className }: WordmarkProps) {
  return (
    <Link
      href={href}
      aria-label="Fit40 home"
      className={cn(
        'font-display text-[21px] leading-none font-bold tracking-tight',
        'rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
    >
      <span className="text-foreground">Fit</span>
      <span className="text-primary">40</span>
    </Link>
  );
}
