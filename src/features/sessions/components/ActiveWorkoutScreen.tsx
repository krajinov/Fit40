import type { ActiveWorkoutView } from '@/features/sessions/active-workout-view';
import { formatSessionClock } from '@/features/sessions/active-workout-views';
import { ActiveWorkoutHeader } from '@/features/sessions/components/ActiveWorkoutHeader';
import { SessionProgressCard } from '@/features/sessions/components/SessionProgressCard';
import { SessionExerciseCard } from '@/features/sessions/components/SessionExerciseCard';
import { UpcomingExerciseList } from '@/features/sessions/components/UpcomingExerciseList';
import { SessionFinishBar } from '@/features/sessions/components/SessionFinishBar';

interface ActiveWorkoutScreenProps {
  readonly view: ActiveWorkoutView;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

/**
 * In-progress state of the Active Workout screen (locked design):
 * header with the live status eyebrow, the progress band, the exercise
 * cards (done/active/partial — each still loggable), the dimmed "Up next"
 * band, and the Finish action (inline on desktop, sticky bottom bar on
 * mobile). Server Component composition only — the interactive islands are
 * the logger and the set rows.
 */
export function ActiveWorkoutScreen({
  view,
  programSlug,
  weekNumber,
  workoutOrder,
}: ActiveWorkoutScreenProps) {
  const session = view.session;
  if (session === null || view.progress === null) {
    return null;
  }

  const logsByOrder = new Map<number, (typeof session.exerciseLogs)[number]>();
  for (const log of session.exerciseLogs) {
    logsByOrder.set(log.order, log);
  }

  const startedCards = view.cards.filter((card) => card.kind !== 'upcoming');
  const upcomingCards = view.cards.filter((card) => card.kind === 'upcoming');

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <ActiveWorkoutHeader
        workout={view.workout}
        programSlug={programSlug}
        weekNumber={weekNumber}
        workoutOrder={workoutOrder}
        eyebrow={`IN PROGRESS · STARTED ${formatSessionClock(session.startedAt)}`}
      />

      <SessionProgressCard progress={view.progress} />

      <div className="flex flex-col gap-4 md:gap-6">
        {startedCards.map((card) => {
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
            />
          );
        })}
      </div>

      <UpcomingExerciseList
        upcoming={upcomingCards}
        logs={logsByOrder}
        sessionId={session.sessionId}
        programSlug={programSlug}
        weekNumber={weekNumber}
        workoutOrder={workoutOrder}
      />

      <SessionFinishBar
        sessionId={session.sessionId}
        programSlug={programSlug}
        weekNumber={weekNumber}
        workoutOrder={workoutOrder}
      />
    </div>
  );
}
