import { cn } from '@/lib/utils';
import type { ScheduleActionError as ScheduleActionErrorType } from '@/features/schedule/types/schedule-action-state';

interface ScheduleActionErrorProps {
  readonly error: ScheduleActionErrorType;
  readonly className?: string;
}

/**
 * Inline error for a scheduling action. Expected application errors surface
 * their own message; unexpected errors never reach this component (they are
 * thrown to the error boundary). `role="alert"` announces it to assistive
 * technology, matching the enrollment/profile error leaves.
 */
export function ScheduleActionError({ error, className }: ScheduleActionErrorProps) {
  return (
    <p role="alert" className={cn('text-xs text-destructive', className)}>
      {error.message}
    </p>
  );
}