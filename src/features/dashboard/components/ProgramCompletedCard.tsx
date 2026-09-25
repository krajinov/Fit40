import Link from 'next/link';

import { Badge } from '@/components/shared/Badge';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ProgramCompletedCardProps {
  readonly programName: string;
  readonly programSlug: string;
  readonly completedWorkouts: number;
  readonly totalWorkouts: number;
  readonly className?: string;
}

/**
 * Completion state for the main column (no Pencil mockup exists for a
 * fully completed program): confirms the finished plan, links to the M14
 * completion summary (the primary completed-state destination), and keeps
 * the catalog link. No restart control lives on the dashboard — that is a
 * locked M14 product decision (restart belongs to the summary route and the
 * program panel).
 */
export function ProgramCompletedCard({
  programName,
  programSlug,
  completedWorkouts,
  totalWorkouts,
  className,
}: ProgramCompletedCardProps) {
  return (
    <section
      aria-label="Program completed"
      className={cn(
        'flex flex-col items-start gap-3 rounded-card border border-border bg-card p-8',
        className,
      )}
    >
      <Badge variant="done">Program completed</Badge>
      <h2 className="font-display text-2xl font-bold text-foreground md:text-[32px]">
        You finished {programName}
      </h2>
      <p className="text-[15px] text-ink-2">
        All {totalWorkouts} {totalWorkouts === 1 ? 'workout' : 'workouts'} completed
        ({completedWorkouts} logged sessions). Explore a new program to keep going.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/programs/${programSlug}/completed`}
          className={buttonVariants()}
        >
          View summary
        </Link>
        <Link href="/programs" className={buttonVariants({ variant: 'secondary' })}>
          Browse programs
        </Link>
      </div>
    </section>
  );
}
