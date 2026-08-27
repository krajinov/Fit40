import type { SessionActionError as SessionActionErrorType } from '@/features/sessions/types/session-action-state';

import { cn } from '@/lib/utils';

interface SessionActionErrorProps {
  readonly error: SessionActionErrorType;
  readonly className?: string;
}

/**
 * Inline error for a session mutation action.
 *
 * `SESSION_MODIFIED` gets a tailored recovery message: the session changed
 * elsewhere and the caller refreshes the latest state. All other expected
 * application errors surface their own message.
 */
export function SessionActionError({ error, className }: SessionActionErrorProps) {
  return (
    <p role="alert" className={cn('text-xs text-destructive', className)}>
      {error.code === 'SESSION_MODIFIED'
        ? 'This session was modified in another tab or device. Reloading the latest state…'
        : error.message}
    </p>
  );
}
