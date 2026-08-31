import { cn } from '@/lib/utils';

import type { ProfileActionError } from '@/features/profile/types/profile-action-state';

interface ProfileActionErrorProps {
  readonly error: ProfileActionError;
  readonly className?: string;
}

export function ProfileActionErrorMessage({ error, className }: ProfileActionErrorProps) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn('rounded-callout border border-destructive/30 bg-destructive/5 px-4 py-3', className)}
    >
      <p className="text-sm font-semibold text-destructive">{error.message}</p>
      {error.fieldErrors && Object.keys(error.fieldErrors).length > 0 && (
        <ul className="mt-2 list-inside list-disc text-sm text-destructive">
          {Object.entries(error.fieldErrors).flatMap(([field, messages]) =>
            messages.map((message) => (
              <li key={`${field}-${message}`}>
                <span className="sr-only">{field}: </span>
                {message}
              </li>
            )),
          )}
        </ul>
      )}
    </div>
  );
}
