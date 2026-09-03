import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Empty state (locked design): radius 20, border, padding 40, centered icon +
 * Inter 16/600 title + Inter 14 body.
 */
export interface EmptyStateProps {
  readonly icon?: ReactNode;
  readonly title: string;
  readonly body?: string;
  readonly className?: string;
}

export function EmptyState({ icon, title, body, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-card border border-border p-10 text-center',
        className,
      )}
    >
      {icon !== undefined && <div className="mb-1 text-ink-3">{icon}</div>}
      <p className="text-base font-semibold text-foreground">{title}</p>
      {body !== undefined && <p className="max-w-65 text-sm text-ink-2">{body}</p>}
    </div>
  );
}
