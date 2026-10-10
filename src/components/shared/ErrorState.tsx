import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Recoverable error state (M19 S1). Presentational and dependency-free — it
 * imports no Button/client primitive, so it stays safe to render from the
 * route-group `error.tsx` boundaries (and anywhere else). Geometry mirrors
 * `EmptyState` (radius 20, border, padding 40, centered copy).
 *
 * CONTRACT: this component only ever renders the caller-supplied `title` and
 * `body`. It never receives or renders a raw `Error`, so internal messages,
 * stack traces, SQL and digests cannot leak through it. The retry control is
 * supplied by the caller as `action` so the client boundary owns `reset()`.
 */
export interface ErrorStateProps {
  readonly title: string;
  readonly body?: string;
  readonly action?: ReactNode;
  readonly className?: string;
}

export function ErrorState({ title, body, action, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center gap-3 rounded-card border border-border p-10 text-center',
        className,
      )}
    >
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {body !== undefined && <p className="max-w-65 text-sm text-ink-2">{body}</p>}
      {action !== undefined && <div className="mt-1">{action}</div>}
    </div>
  );
}
