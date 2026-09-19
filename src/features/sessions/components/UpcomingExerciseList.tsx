import type { WorkoutSessionExerciseDto } from '@/application/dto/workout-session';
import type { SessionExerciseCardView } from '@/features/sessions/active-workout-views';
import { UpcomingExerciseRow } from '@/features/sessions/components/UpcomingExerciseRow';

interface UpcomingExerciseListProps {
  /** Untouched exercise rows, in log order. */
  readonly upcoming: ReadonlyArray<SessionExerciseCardView>;
  /** All session logs, keyed by order, for the hidden loggers' prescriptions. */
  readonly logs: ReadonlyMap<number, WorkoutSessionExerciseDto>;
  readonly sessionId: string;
  /**
   * The rendered snapshot's session version (PR #13 Finding 1), forwarded to
   * every mutation island a row hosts.
   */
  readonly expectedSessionVersion: number;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

/**
 * "Up next" band (locked design): untouched exercises as dimmed compact rows
 * (surface-2 order circle, ink-2 name, ink-3 prescription) in one surface
 * container.
 *
 * The Active Workout screen no longer owns occurrence state through this
 * grouping: every occurrence renders under the keyed `SessionOccurrence`
 * boundary in ONE canonical-order list (PR #13 P2), and that list stamps each
 * compact row with its grouping classes. This grouped composition remains the
 * standalone presentational wrapper (and its regression tests): a row's local
 * draft/disclosure state is owned by the occurrence boundary, never by this
 * container.
 *
 * Capability note: the domain allows logging sets in any order, and the
 * pre-redesign screen offered a logger on every exercise. The locked frames
 * show these rows quiet, so each row keeps a subtle expand affordance that
 * reveals the same set logger — the visual stays as designed while
 * out-of-order logging remains possible. Skipped occurrences never appear
 * here (they render as their own muted card kind in the main list, M10).
 */
export function UpcomingExerciseList({
  upcoming,
  logs,
  sessionId,
  expectedSessionVersion,
  programSlug,
  weekNumber,
  workoutOrder,
}: UpcomingExerciseListProps) {
  if (upcoming.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Up next"
      className="rounded-card border border-border bg-card px-4 py-0.5 md:px-6"
    >
      <ol className="divide-y divide-border">
        {upcoming.map((exercise) => (
          <UpcomingExerciseRow
            key={exercise.renderKey}
            exercise={exercise}
            log={logs.get(exercise.order)}
            sessionId={sessionId}
            expectedSessionVersion={expectedSessionVersion}
            programSlug={programSlug}
            weekNumber={weekNumber}
            workoutOrder={workoutOrder}
          />
        ))}
      </ol>
    </section>
  );
}
