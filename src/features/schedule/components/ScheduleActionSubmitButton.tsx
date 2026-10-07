'use client';

import { useFormStatus } from 'react-dom';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ScheduleActionSubmitButtonProps {
  /** Locked action label, rendered verbatim when idle. */
  readonly label: string;
  /** Concise pending label, matching the sibling actions' convention. */
  readonly pendingLabel: string;
  readonly className?: string;
}

/**
 * The pending submit leaf shared by the M17 settlement forms (M17 Slice 11).
 *
 * `useFormStatus` reports the enclosing form's submission state, so the button
 * disables itself while its own action is in flight — one dispatch can never
 * be sent twice — and the label swaps to the concise pending wording. The
 * height comes from the locked secondary button variant (52px), so the touch
 * target never shrinks; `whitespace-normal` lets the fixed-width calendar cell
 * wrap the label instead of overflowing.
 */
export function ScheduleActionSubmitButton({
  label,
  pendingLabel,
  className,
}: ScheduleActionSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        buttonVariants({ variant: 'secondary', size: 'sm' }),
        'w-full whitespace-normal',
        className,
      )}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
