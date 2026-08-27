import type { SessionActionError as SessionActionErrorType } from '@/features/sessions/types/session-action-state';

import { cn } from '@/lib/utils';

interface SessionActionErrorProps {
  readonly error: SessionActionErrorType;
  readonly className?: string;
}

/**
 * Inline error for a session action.
 *
 * `SESSION_MODIFIED` and `SESSION_ALREADY_EXISTS` get tailored recovery
 * messages because the underlying session state is newer than what the page
 * shows and the caller refreshes the latest state. All other expected
 * application errors surface their own message.
 */
export function SessionActionError({ error, className }: SessionActionErrorProps) {
  let message = error.message;

  if (error.code === 'SESSION_MODIFIED') {
    message = 'This session was modified in another tab or device. Reloading the latest state…';
  } else if (error.code === 'SESSION_ALREADY_EXISTS') {
    message = 'A session already exists for this workout. Loading the current session…';
  }

  return (
    <p role="alert" className={cn('text-xs text-destructive', className)}>
      {message}
    </p>
  );
}
