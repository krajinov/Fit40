import { Badge } from '@/components/shared/Badge';
import { cn } from '@/lib/utils';
import type { ProgramWeekDto } from '@/application/dto/program';
import {
  ScheduledWorkoutCard,
  type ScheduledWorkoutState,
} from '@/features/programs/components/ScheduledWorkoutCard';

/** Lifecycle of one program week for the enrolled visitor. */
export type ProgramWeekStatus = 'completed' | 'in-progress' | 'upcoming';

interface ProgramWeekSectionProps {
  readonly programSlug: string;
  readonly week: ProgramWeekDto;
  readonly status: ProgramWeekStatus;
  readonly completedIds: ReadonlySet<string>;
  /**
   * Route key ("week-order") of the enrollment's next incomplete workout,
   * or null for anonymous visitors / completed programs.
   */
  readonly upNextKey: string | null;
}

/**
 * One week card of the program schedule (locked design): Sora week title,
 * status badge, and the scheduled workout cards. Anonymous visitors see the
 * same layout with every workout in its plain "scheduled" state.
 */
export function ProgramWeekSection({
  programSlug,
  week,
  status,
  completedIds,
  upNextKey,
}: ProgramWeekSectionProps) {
  return (
    <section
      aria-labelledby={`week-${week.weekNumber}-heading`}
      className={cn(
        'flex flex-col gap-3 rounded-card border bg-card p-4 md:gap-4 md:p-6',
        status === 'in-progress' ? 'border-accent-tint-border' : 'border-border',
      )}
    >
      <header className="flex items-center justify-between gap-2">
        <h3
          id={`week-${week.weekNumber}-heading`}
          className="font-display text-[15px] font-semibold text-foreground md:text-[17px]"
        >
          Week {week.weekNumber}
        </h3>
        {status === 'completed' ? (
          <Badge variant="done">Completed</Badge>
        ) : status === 'in-progress' ? (
          <Badge variant="accent">In progress</Badge>
        ) : (
          <Badge>Upcoming</Badge>
        )}
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {week.scheduledWorkouts.map((scheduled) => {
          let state: ScheduledWorkoutState = 'scheduled';
          if (completedIds.has(scheduled.scheduledWorkoutId)) {
            state = 'completed';
          } else if (
            upNextKey === `${week.weekNumber}-${scheduled.order}` &&
            status === 'in-progress'
          ) {
            state = 'up-next';
          }

          return (
            <ScheduledWorkoutCard
              key={scheduled.scheduledWorkoutId}
              programSlug={programSlug}
              weekNumber={week.weekNumber}
              scheduled={scheduled}
              state={state}
            />
          );
        })}
      </div>
    </section>
  );
}
