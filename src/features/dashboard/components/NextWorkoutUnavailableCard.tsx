import { Badge } from '@/components/shared/Badge';
import { cn } from '@/lib/utils';

interface NextWorkoutUnavailableCardProps {
  readonly className?: string;
}

/**
 * "Up next" fallback for a next workout whose preview could not be resolved
 * (e.g. the exercise catalog changed mid-request). Deliberately distinct
 * from ProgramCompletedCard: the enrollment still has a next workout, so
 * this must not claim the program is finished and must not fabricate
 * workout data. Shown in the same card position as NextWorkoutCard.
 */
export function NextWorkoutUnavailableCard({
  className,
}: NextWorkoutUnavailableCardProps) {
  return (
    <section
      aria-label="Next workout unavailable"
      className={cn(
        'flex flex-col gap-4 rounded-card border border-border bg-card p-6 md:gap-6 md:p-9',
        className,
      )}
    >
      <div className="flex flex-col gap-2.5">
        <Badge>UP NEXT</Badge>
        <h2 className="font-display text-2xl font-bold text-foreground md:text-[32px]">
          Next workout unavailable
        </h2>
        <p className="text-sm text-ink-2 md:text-[15px]">
          We couldn&apos;t load the next workout right now.
        </p>
      </div>
    </section>
  );
}
