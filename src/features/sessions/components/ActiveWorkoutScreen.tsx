import type { ActiveWorkoutView } from '@/features/sessions/active-workout-view';
import { formatSessionClock, splitSessionExerciseCardBands } from '@/features/sessions/active-workout-views';
import { ActiveWorkoutHeader } from '@/features/sessions/components/ActiveWorkoutHeader';
import { AddSessionExercisePanel } from '@/features/sessions/components/AddSessionExercisePanel';
import { SessionProgressCard } from '@/features/sessions/components/SessionProgressCard';
import {
  SessionOccurrence,
  type UpcomingGroupPosition,
} from '@/features/sessions/components/SessionOccurrence';
import { SessionFinishBar } from '@/features/sessions/components/SessionFinishBar';

interface ActiveWorkoutScreenProps {
  readonly view: ActiveWorkoutView;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

/** The compact row's position inside the presentational "Up next" group. */
function upcomingGroupPosition(index: number, count: number): UpcomingGroupPosition {
  if (count === 1) return 'only';
  if (index === 0) return 'first';
  if (index === count - 1) return 'last';
  return 'middle';
}

/**
 * In-progress state of the Active Workout screen (locked design):
 * header with the live status eyebrow, the progress band, every occurrence
 * (done/active/partial/skipped as full cards, untouched as compact "Up next"
 * rows — each still loggable), and the Finish action (inline on desktop,
 * sticky bottom bar on mobile).
 *
 * Every occurrence renders through ONE keyed `SessionOccurrence` boundary in a
 * single canonical-order list (PR #13 P2): the full-card and compact "Up next"
 * representations stay visually distinct, but they are no longer two React
 * parents, so a reorder that moves an occurrence between them keeps that
 * occurrence's local draft/disclosure state. The pure view mapper still owns
 * the band cut; concatenating the bands reproduces the DTO order
 * element-for-element and this component never sorts.
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

  // The canonical render bands come from the pure view mapper (PR #13
  // Finding 4): the cut sits AFTER the last touched occurrence, so a skipped
  // (or otherwise touched) card can never be pulled ahead of an earlier
  // untouched one. Concatenating the bands reproduces the canonical DTO order
  // element-for-element; the occurrence list only selects the representation
  // per entry — it holds no partitioning or ordering logic of its own.
  const { cards: cardBand, upcoming: upcomingBand } = splitSessionExerciseCardBands(view.cards);
  const occurrences = [
    ...cardBand.map((card) => ({ card, representation: 'card' as const, position: null })),
    ...upcomingBand.map((card, index) => ({
      card,
      representation: 'upcoming' as const,
      position: upcomingGroupPosition(index, upcomingBand.length),
    })),
  ];

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

      <ol className="m-0 flex list-none flex-col gap-4 p-0 md:gap-6">
        {occurrences.map(({ card, representation, position }) => {
          const log = logsByOrder.get(card.order);
          if (log === undefined) {
            return null;
          }
          return (
            <SessionOccurrence
              key={card.renderKey}
              card={card}
              log={log}
              representation={representation}
              upcomingPosition={position}
              sessionId={session.sessionId}
              expectedSessionVersion={session.version}
              programSlug={programSlug}
              weekNumber={weekNumber}
              workoutOrder={workoutOrder}
            />
          );
        })}
      </ol>

      {/* M11 Add Exercise: the explicit session-added occurrence flow. The
          panel is NOT occurrence-owned state, so appending an occurrence
          leaves every existing keyed occurrence subtree untouched. */}
      <AddSessionExercisePanel
        sessionId={session.sessionId}
        expectedSessionVersion={session.version}
        programSlug={programSlug}
        weekNumber={weekNumber}
        workoutOrder={workoutOrder}
        addableExercises={view.addableExercises}
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