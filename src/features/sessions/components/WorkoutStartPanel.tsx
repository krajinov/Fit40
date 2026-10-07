import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { WorkoutCtaState } from '@/features/sessions/workout-detail-view';

interface WorkoutStartPanelProps {
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  /** Resolved state; see {@link WorkoutCtaState}. */
  readonly ctaState: WorkoutCtaState;
}

/**
 * CTA band (locked design): accent-tint card with "Ready when you are", a
 * state-aware subtitle, and the Start/Resume CTA linking to the session
 * page — the session page owns the actual start/resume/join semantics and
 * never creates a duplicate session. The "View program" secondary CTA is
 * desktop-only in the locked design; mobile shows the full-width primary
 * CTA only.
 */
export function WorkoutStartPanel({
  programSlug,
  weekNumber,
  workoutOrder,
  ctaState,
}: WorkoutStartPanelProps) {
  const sessionPath = `/programs/${programSlug}/weeks/${weekNumber}/workouts/${workoutOrder}/session`;

  const subtitle =
    ctaState === 'completed'
      ? 'Your logged sets are kept — review them in the session view.'
      : ctaState === 'anonymous'
        ? 'Create a free account or sign in to start and track this workout.'
        : ctaState === 'not-enrolled'
          ? 'Join this program to start and track the workout.'
          : 'Your recommendations will be waiting in the session logger.';

  const primaryLabel =
    ctaState === 'resume'
      ? 'Resume workout'
      : ctaState === 'completed'
        ? 'View session'
        : ctaState === 'anonymous'
          ? 'Sign in to start'
          : ctaState === 'not-enrolled'
            ? 'Join program to start'
            : 'Start workout';

  // Anonymous visitors are sent through the login flow straight to the
  // session page — the same destination the session page's own requireUser
  // redirect would produce, minus one hop. Every other state links to the
  // session page, which owns the start/resume/join semantics.
  const primaryHref =
    ctaState === 'anonymous'
      ? `/login?next=${encodeURIComponent(sessionPath)}`
      : sessionPath;

  return (
    <section
      aria-label="Start this workout"
      className={cn(
        'flex flex-col gap-2.5 rounded-card border border-accent-tint-border bg-accent-tint p-5 md:gap-5 md:p-7',
      )}
    >
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-semibold text-foreground md:text-xl">
          Ready when you are
        </h2>
        <p className="text-[13px] text-ink-2 md:text-sm">{subtitle}</p>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-3">
        <Link href={primaryHref} className={cn(buttonVariants(), 'w-full md:w-auto')}>
          {primaryLabel}
        </Link>
        {/* Desktop-only in the locked design; on mobile the breadcrumb link
            covers the same navigation. */}
        <Link
          href={`/programs/${programSlug}`}
          className={cn(buttonVariants({ variant: 'secondary' }), 'hidden md:inline-flex')}
        >
          View program
        </Link>
      </div>
    </section>
  );
}
