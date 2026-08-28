import type { ProfileActionError } from '@/features/profile/types/profile-action-state';

interface ProfileActionErrorProps {
  readonly error: ProfileActionError;
  readonly className?: string;
}

export function ProfileActionErrorMessage({ error, className }: ProfileActionErrorProps) {
  return (
    <div className={className} role="alert" aria-live="polite">
      <p className="text-sm font-medium text-destructive">{error.message}</p>
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
