import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Section card (locked design): white surface, radius 20, padding 32, gap 24.
 * Optional eyebrow renders in accent-strong Inter 12/600 above the Sora
 * 22/600 title. Padding can be reduced for compact (mobile) placements.
 */
export interface SectionCardProps {
  readonly id?: string;
  readonly eyebrow?: string;
  readonly title?: string;
  readonly children: ReactNode;
  readonly className?: string;
}

export function SectionCard({ id, eyebrow, title, children, className }: SectionCardProps) {
  return (
    <section id={id} className={cn('rounded-card border border-border bg-card p-8', className)}>
      {(eyebrow !== undefined || title !== undefined) && (
        <header className="mb-6 space-y-1.5">
          {eyebrow !== undefined && (
            <p className="text-xs font-semibold tracking-wide text-accent-foreground">{eyebrow}</p>
          )}
          {title !== undefined && (
            <h2 className="font-display text-[22px] font-semibold text-foreground">{title}</h2>
          )}
        </header>
      )}
      {children}
    </section>
  );
}
