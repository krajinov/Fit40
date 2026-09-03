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
 * fully completed program): confirms the finished plan and links to the
 * program page, whose enrollment panel shows the same completion truth.
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
        <Link href="/programs" className={buttonVariants()}>
          Browse programs
        </Link>
        <Link
          href={`/programs/${programSlug}`}
          className={buttonVariants({ variant: 'secondary' })}
        >
          View program
        </Link>
      </div>
    </section>
  );
}
