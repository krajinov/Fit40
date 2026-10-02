import { Badge } from '@/components/shared/Badge';
import { cn } from '@/lib/utils';
import type { ProgramWeekDto } from '@/application/dto/program';
import {
  ScheduledWorkoutCard,
  type ScheduledWorkoutState,
} from '@/features/programs/components/ScheduledWorkoutCard';
import type { ProgramWeekStatus } from '@/features/programs/week-status';

/**
 * Lifecycle of one program week for the enrolled visitor. Re-exported from the
 * pure status resolver (M17 final review) so importers keep one source of truth.
 */
export type { ProgramWeekStatus } from '@/features/programs/week-status';

interface ProgramWeekSectionProps {
  readonly programSlug: string;
  readonly week: ProgramWeekDto;
  readonly status: ProgramWeekStatus;
  readonly completedIds: ReadonlySet<string>;
  /**
   * Route keys ("week-order") of occurrences the M15 read resolved as
   * `not-performed` (M17 Slice 11). Empty for anonymous visitors or a
   * degraded schedule read — the recorded fact is never guessed from a
   * missing session.
   */
  readonly recordedKeys?: ReadonlySet<string>;
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
  recordedKeys = new Set<string>(),
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
        ) : status === 'settled' ? (
          /* Settled but not completed (M17): every authored occurrence is
             settled, yet at least one is recorded as not performed. Factual
             non-completion vocabulary — never "Completed", "Failed", "Missed",
             "Skipped" or "Incomplete". */
          <Badge>Settled</Badge>
        ) : (
          <Badge>Upcoming</Badge>
        )}
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {week.scheduledWorkouts.map((scheduled) => {
          const key = `${week.weekNumber}-${scheduled.order}`;
          // Settlement precedence mirrors the M15 status resolver: a recorded
          // occurrence is settled truth, so it is never also "up next".
          const recorded = recordedKeys.has(key);
          let state: ScheduledWorkoutState = 'scheduled';
          if (completedIds.has(scheduled.scheduledWorkoutId)) {
            state = 'completed';
          } else if (!recorded && upNextKey === key && status === 'in-progress') {
            state = 'up-next';
          }

          return (
            <ScheduledWorkoutCard
              key={scheduled.scheduledWorkoutId}
              programSlug={programSlug}
              weekNumber={week.weekNumber}
              scheduled={scheduled}
              state={state}
              recorded={recorded}
            />
          );
        })}
      </div>
    </section>
  );
}
