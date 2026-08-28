import type { AuthActionError } from '@/features/auth/types/auth-action-state';

interface AuthActionErrorProps {
  readonly error: AuthActionError;
  readonly className?: string;
}

export function AuthActionError({ error, className }: AuthActionErrorProps) {
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
