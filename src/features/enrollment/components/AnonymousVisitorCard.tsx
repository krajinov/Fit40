import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AnonymousVisitorCardProps {
  /** Program detail path to return to after signing in. */
  readonly programPath: string;
  readonly className?: string;
}

/**
 * Notice card for signed-out visitors on the public program detail page.
 * The page itself stays readable and public (catalog semantics); this card
 * offers the sign-in / registration entry points, with the sign-in deep
 * link returning to this program. No enrollment or progress data is
 * resolved for anonymous visitors.
 */
export function AnonymousVisitorCard({ programPath, className }: AnonymousVisitorCardProps) {
  return (
    <section
      aria-label="Sign in to join"
      className={cn(
        'flex flex-col gap-3 rounded-card border border-border bg-card p-5 md:flex-row md:items-center md:justify-between md:p-8',
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-semibold text-foreground">
          Train with this program
        </h2>
        <p className="text-sm text-ink-2">
          Create a free account or sign in to join this plan and track every workout.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row md:shrink-0">
        <Link
          href={`/login?next=${encodeURIComponent(programPath)}`}
          className={cn(buttonVariants(), 'w-full sm:w-auto')}
        >
          Sign in
        </Link>
        <Link
          href="/register"
          className={cn(buttonVariants({ variant: 'secondary' }), 'w-full sm:w-auto')}
        >
          Create account
        </Link>
      </div>
    </section>
  );
}
