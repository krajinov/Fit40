import Link from 'next/link';

import type { ScheduledWorkoutExerciseDto } from '@/application/dto/program';
import { formatPrescription } from '@/features/programs/program-labels';
import { EQUIPMENT_LABELS } from '@/features/exercises/exercise-labels';
import type { WorkoutExerciseTargetView } from '@/features/sessions/workout-target-views';
import { WorkoutTargetBlock } from '@/features/sessions/components/WorkoutTargetBlock';

interface WorkoutExerciseRowProps {
  readonly exercise: ScheduledWorkoutExerciseDto;
  /** Personalized overload view for this position, already mapped. */
  readonly target: WorkoutExerciseTargetView;
}

/**
 * One exercise row of the workout detail list (approved M8 Workout Detail
 * design): order circle, name + equipment badge, prescription · rest, and
 * the M8 target treatment — the previous-performance context and the target
 * block (desktop right-aligned 300px column; mobile stacked in full width
 * under the prescription). First exposure renders one quiet muted line, no
 * block — the authored prescription stays primary. Exercise names render as
 * normal horizontal text (no per-character wrapping).
 */
export function WorkoutExerciseRow({ exercise, target }: WorkoutExerciseRowProps) {
  const block = target.block;

  return (
    <li className="flex flex-col gap-2 py-5 md:flex-row md:items-start md:gap-6">
      <span
        aria-hidden="true"
        className="flex size-[30px] shrink-0 items-center justify-center rounded-pill bg-surface-2 text-[13px] font-semibold text-ink-2 md:size-8 md:text-sm"
      >
        {exercise.order}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href={`/exercises/${exercise.exerciseSlug}`}
            className="text-[15px] font-semibold text-ink underline-offset-4 hover:text-accent-strong hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:text-base"
          >
            {exercise.exerciseName}
          </Link>
          <span className="inline-flex h-6 items-center rounded-pill bg-surface-2 px-2.5 text-xs font-medium text-ink-2">
            {EQUIPMENT_LABELS[exercise.equipment]}
          </span>
        </div>

        <p className="text-sm font-medium text-ink-2 md:text-[15px]">
          {formatPrescription(exercise.prescription)} · {exercise.restSeconds}s rest
        </p>

        {exercise.notes !== null && exercise.notes !== '' && (
          <p className="text-[13px] text-ink-3 md:text-sm">{exercise.notes}</p>
        )}

        {/* M8 mobile treatment: previous performance and target block stack
            under the prescription in full width; first exposure stays a
            single quiet line. */}
        {(target.lastTimeLabel !== null || block !== null || target.quietLabel !== null) && (
          <div className="flex flex-col gap-2 md:hidden">
            {target.lastTimeLabel !== null && (
              <span className="text-xs text-ink-3">{target.lastTimeLabel}</span>
            )}
            {target.quietLabel !== null && (
              <span className="text-xs text-ink-3">{target.quietLabel}</span>
            )}
            {block !== null && <WorkoutTargetBlock block={block} compact />}
          </div>
        )}
      </div>

      {(target.lastTimeLabel !== null || block !== null || target.quietLabel !== null) && (
        <div className="hidden shrink-0 flex-col items-end gap-1.5 md:flex">
          {target.lastTimeLabel !== null && (
            <span className="text-[13px] text-ink-3">{target.lastTimeLabel}</span>
          )}
          {block !== null && <WorkoutTargetBlock block={block} className="md:w-[300px]" />}
          {block === null && target.quietLabel !== null && (
            <span className="text-[13px] text-ink-3">{target.quietLabel}</span>
          )}
        </div>
      )}
    </li>
  );
}

