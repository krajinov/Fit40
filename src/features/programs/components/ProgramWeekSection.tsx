import { Badge } from '@/components/shared/Badge';
import { cn } from '@/lib/utils';
import type { ProgramWeekDto } from '@/application/dto/program';
import {
  ScheduledWorkoutCard,
  type ScheduledWorkoutState,
} from '@/features/programs/components/ScheduledWorkoutCard';
import type { ProgramWeekLifecycle } from '@/application/dto/program-week-lifecycle';

/**
 * Lifecycle of one program week for the enrolled visitor. Re-exported from the
 * APPLICATION-owned resolver (M17 architecture review) so importers keep one
 * source of truth: the meaning is resolved in the Application layer and this
 * component only renders it.
 */
export type { ProgramWeekLifecycle } from '@/application/dto/program-week-lifecycle';

interface ProgramWeekSectionProps {
  readonly programSlug: string;
  readonly week: ProgramWeekDto;
  /**
   * The week's ALREADY-RESOLVED lifecycle, produced by the Application-owned
   * `resolveProgramWeekLifecycle`. This component renders it (label, badge
   * style) and never derives the meaning from occurrence sets.
   */
  readonly status: ProgramWeekLifecycle;
  readonly completedIds: ReadonlySet<string>;
  /**
   * Authored occurrence ids the run settled as recorded not performed (M17),
   * from the closure read's identity set (or the M15 read's fallback). Empty
   * for anonymous visitors or when neither read supplied one — the recorded
   * fact is never guessed from a missing session.
   */
  readonly notPerformedIds?: ReadonlySet<string>;
  /**
   * Authored occurrence id of the run's next/open workout, or null for
   * anonymous visitors / completed programs.
   */
  readonly upNextOccurrenceId: string | null;
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
  notPerformedIds = new Set<string>(),
  upNextOccurrenceId,
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
          // Membership lookups over application-provided identities - never a
          // lifecycle decision: a recorded occurrence is settled truth, so it
          // is never also "up next".
          const recorded = notPerformedIds.has(scheduled.scheduledWorkoutId);
          let state: ScheduledWorkoutState = 'scheduled';
          if (completedIds.has(scheduled.scheduledWorkoutId)) {
            state = 'completed';
          } else if (
            !recorded &&
            upNextOccurrenceId === scheduled.scheduledWorkoutId &&
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
              recorded={recorded}
            />
          );
        })}
      </div>
    </section>
  );
}
