'use client';

import { useFormStatus } from 'react-dom';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ProfileSubmitButtonProps {
  readonly label: string;
  readonly pendingLabel: string;
  readonly className?: string;
}

export function ProfileSubmitButton({ label, pendingLabel, className }: ProfileSubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(buttonVariants(), className)}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
