import { cn } from '@/lib/utils';

/**
 * Inline field-error list for the profile forms (Fit40 danger token).
 * Render an `id` so the failing control can reference it via aria-describedby.
 */
export interface ProfileFieldErrorsProps {
  readonly id?: string;
  readonly messages?: ReadonlyArray<string>;
  readonly className?: string;
}

export function ProfileFieldErrors({ id, messages, className }: ProfileFieldErrorsProps) {
  if (!messages || messages.length === 0) return null;

  return (
    <ul id={id} className={cn('mt-2 list-inside list-disc text-sm text-destructive', className)}>
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}
