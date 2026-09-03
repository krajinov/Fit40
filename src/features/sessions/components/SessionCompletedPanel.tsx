import { Badge } from '@/components/shared/Badge';
import type { WorkoutSessionDto } from '@/application/dto/workout-session';
import type { SessionExerciseCardView, SessionProgressView } from '@/features/sessions/active-workout-views';
import { ActiveWorkoutHeader } from '@/features/sessions/components/ActiveWorkoutHeader';
import { SessionProgressCard } from '@/features/sessions/components/SessionProgressCard';
import { SessionExerciseCard } from '@/features/sessions/components/SessionExerciseCard';
import { formatVolumeLabel } from '@/features/sessions/active-workout-views';
import type { ScheduledWorkoutDetailDto } from '@/application/dto/program';
import type { WorkoutSessionExerciseDto } from '@/application/dto/workout-session';
import Link from 'next/link';

interface SessionCompletedPanelProps {
  readonly workout: ScheduledWorkoutDetailDto;
  readonly session: WorkoutSessionDto;
  readonly cards: ReadonlyArray<SessionExerciseCardView>;
  readonly progress: SessionProgressView;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

/**
 * Completed state of the session screen (locked design): "COMPLETED" eyebrow,
 * session metrics as badges, the full progress band, and read-only exercise
 * cards — no loggers, no edit/delete actions (the domain restricts session
 * mutations to in-progress sessions). The screen's eyebrow timestamp is the
 * completion time.
 */
export function SessionCompletedPanel({
  workout,
  session,
  cards,
  progress,
  programSlug,
  weekNumber,
  workoutOrder,
}: SessionCompletedPanelProps) {
  const logsByOrder = new Map<number, WorkoutSessionExerciseDto>();
  for (const log of session.exerciseLogs) {
    logsByOrder.set(log.order, log);
  }

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <ActiveWorkoutHeader
        workout={workout}
        programSlug={programSlug}
        weekNumber={weekNumber}
        workoutOrder={workoutOrder}
        eyebrow={completedEyebrow(session)}
      />

      <SessionProgressCard progress={progress} />

      <section aria-label="Session summary" className="flex flex-wrap gap-2">
        <Badge>{progress.repsLabel}</Badge>
        <Badge>{formatVolumeLabel(session.metrics.volume)} volume</Badge>
        {session.metrics.totalDurationSeconds > 0 && (
          <Badge>{session.metrics.totalDurationSeconds}s duration</Badge>
        )}
        {progress.loggedSets === 0 && <Badge>No sets logged</Badge>}
      </section>

      <div className="flex flex-col gap-4 md:gap-6">
        {cards.map((card) => {
          const log = logsByOrder.get(card.order);
          if (log === undefined) {
            return null;
          }
          return (
            <SessionExerciseCard
              key={card.order}
              card={card}
              log={log}
              sessionId={session.sessionId}
              programSlug={programSlug}
              weekNumber={weekNumber}
              workoutOrder={workoutOrder}
              readOnly
            />
          );
        })}
      </div>

      {/* Mobile navigation back to the workout details screen; the tab bar
          is hidden on session routes. */}
      <Link
        href={`/programs/${programSlug}/weeks/${weekNumber}/workouts/${workoutOrder}`}
        className="text-[13px] font-medium text-ink-3 underline-offset-4 hover:text-ink hover:underline md:hidden"
      >
        &larr; Workout details
      </Link>
    </div>
  );
}

function completedEyebrow(session: WorkoutSessionDto): string {
  if (session.completedAt === null) {
    return 'COMPLETED';
  }
  return `COMPLETED · ${new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(session.completedAt))}`;
}
