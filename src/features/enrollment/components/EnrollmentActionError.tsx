import type { EnrollmentActionError as EnrollmentActionErrorType } from '@/features/enrollment/types/enrollment-action-state';

import { cn } from '@/lib/utils';

interface EnrollmentActionErrorProps {
  readonly error: EnrollmentActionErrorType;
  readonly className?: string;
}

/**
 * Inline error for an enrollment action. Expected application errors surface
 * their own message; unexpected errors never reach this component (they are
 * thrown to the error boundary).
 */
export function EnrollmentActionError({ error, className }: EnrollmentActionErrorProps) {
  return (
    <p role="alert" className={cn('text-xs text-destructive', className)}>
      {error.message}
    </p>
  );
}
