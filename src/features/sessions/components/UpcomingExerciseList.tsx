import { ChevronDown } from 'lucide-react';

import type { WorkoutSessionExerciseDto } from '@/application/dto/workout-session';
import type { SessionExerciseCardView } from '@/features/sessions/active-workout-views';
import { SetLoggerForm } from '@/features/sessions/components/SetLoggerForm';

interface UpcomingExerciseListProps {
  /** Untouched exercise rows, in log order. */
  readonly upcoming: ReadonlyArray<SessionExerciseCardView>;
  /** All session logs, keyed by order, for the hidden loggers' prescriptions. */
  readonly logs: ReadonlyMap<number, WorkoutSessionExerciseDto>;
  readonly sessionId: string;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

/**
 * "Up next" band (locked design): untouched exercises as dimmed compact rows
 * (surface-2 order circle, ink-2 name, ink-3 prescription) in one surface
 * container.
 *
 * Capability note: the domain allows logging sets in any order, and the
 * pre-redesign screen offered a logger on every exercise. The locked frames
 * show these rows quiet, so each row keeps a subtle expand affordance that
 * reveals the same set logger — the visual stays as designed while
 * out-of-order logging remains possible.
 */
export function UpcomingExerciseList({
  upcoming,
  logs,
  sessionId,
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
        {upcoming.map((exercise) => {
          const log = logs.get(exercise.order);
          const logger = exercise.logger;
          if (log === undefined || logger === null) {
            return (
              <li key={exercise.order} className="flex items-center gap-2.5 py-3 md:gap-3.5 md:py-4">
                <span
                  aria-hidden="true"
                  className="flex size-[26px] shrink-0 items-center justify-center rounded-pill bg-surface-2 text-xs font-semibold text-ink-3 md:size-[34px] md:text-sm"
                >
                  {exercise.order}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-2 md:text-base">
                  {exercise.name}
                </span>
                <span className="shrink-0 text-xs text-ink-3 md:text-[13px]">
                  {exercise.prescriptionLabel}
                </span>
              </li>
            );
          }

          return (
            <li key={exercise.order} className="py-1.5 md:py-2">
              <details className="group/up">
                <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-lg py-1.5 transition-colors hover:bg-surface-2/60 md:gap-3.5 [&::-webkit-details-marker]:hidden">
                  <span
                    aria-hidden="true"
                    className="flex size-[26px] shrink-0 items-center justify-center rounded-pill bg-surface-2 text-xs font-semibold text-ink-3 md:size-[34px] md:text-sm"
                  >
                    {exercise.order}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-2 md:text-base">
                    {exercise.name}
                  </span>
                  <span className="shrink-0 text-xs text-ink-3 md:text-[13px]">
                    {exercise.prescriptionLabel}
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className="size-4 shrink-0 text-ink-3 transition-transform group-open/up:rotate-180"
                  />
                </summary>
                <div className="pb-3 pt-1">
                  <SetLoggerForm
                    key={`${exercise.order}-${exercise.setRows.length}-${logger.prefillWeightKg ?? 'none'}`}
                    sessionId={sessionId}
                    exerciseOrder={log.order}
                    prescription={log.prescription}
                    programSlug={programSlug}
                    weekNumber={weekNumber}
                    workoutOrder={workoutOrder}
                    prefillWeightKg={logger.prefillWeightKg}
                    callout={logger.callout}
                  />
                </div>
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
