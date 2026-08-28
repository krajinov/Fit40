'use client';

import { useFormStatus } from 'react-dom';

interface ProfileSubmitButtonProps {
  readonly label: string;
  readonly pendingLabel: string;
}

export function ProfileSubmitButton({ label, pendingLabel }: ProfileSubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 sm:w-auto"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
