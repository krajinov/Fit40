import Link from 'next/link';

import { cn } from '@/lib/utils';
import type { ScheduledWorkoutExerciseDto } from '@/application/dto/program';
import { formatPrescription } from '@/features/programs/program-labels';
import { EQUIPMENT_LABELS } from '@/features/exercises/exercise-labels';
import type {
  WorkoutExerciseTargetView,
  WorkoutTargetChipView,
} from '@/features/sessions/workout-target-views';

interface WorkoutExerciseRowProps {
  readonly exercise: ScheduledWorkoutExerciseDto;
  /** Personalized overload view for this position, already mapped. */
  readonly target: WorkoutExerciseTargetView;
}

/** Chip styling per locked design state (accent / neutral / amber). */
const CHIP_STYLES: Record<
  WorkoutTargetChipView['kind'],
  { readonly container: string; readonly label: string; readonly value: string }
> = {
  increase: {
    container: 'bg-accent-tint',
    label: 'text-accent-strong',
    value: 'text-ink',
  },
  hold: {
    container: 'border border-border-strong bg-surface-2',
    label: 'text-ink-2',
    value: 'text-ink',
  },
  regress: {
    container: 'border border-amber-border bg-amber-tint',
    label: 'text-amber-strong',
    value: 'text-ink',
  },
  'scheme-change': {
    container: 'border border-border-strong bg-card',
    label: 'text-ink-2',
    value: 'text-ink',
  },
};

/**
 * One exercise row of the workout detail list (locked design, desktop
 * ExerciseRow + mobile row): order circle, name + equipment badge,
 * prescription · rest, notes, previous performance and the recommendation
 * chip. The chip stays visually secondary to name/prescription; bodyweight
 * and duration exercises render no chip at all (decided by the mapper, not
 * here) and leave no blank placeholder space.
 */
export function WorkoutExerciseRow({ exercise, target }: WorkoutExerciseRowProps) {
  const chip = target.chip;
  const chipStyle = chip === null ? null : CHIP_STYLES[chip.kind];

  return (
    <li className="flex items-center gap-4 py-5 md:gap-6">
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

        {/* Previous performance + recommendation chip. Mobile keeps them on
            one wrapping line under the prescription (locked mobile row);
            desktop right-aligns them in the row. */}
        {(target.lastTimeLabel !== null || chip !== null) && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 md:hidden">
            {target.lastTimeCompactLabel !== null && (
              <span className="text-xs text-ink-3">{target.lastTimeCompactLabel}</span>
            )}
            {chip !== null && chipStyle !== null && (
              <span className={cn('inline-flex items-center gap-1.5 rounded-[7px] px-2 py-0.5', chipStyle.container)}>
                <span className={cn('text-[10px] font-semibold', chipStyle.label)}>
                  {chip.label === 'TRY TODAY' ? 'TRY' : chip.label === 'NEW REP TARGET' ? 'NEW TARGET' : chip.label}
                </span>
                <span className={cn('text-xs font-semibold font-display', chipStyle.value)}>
                  {chip.valueLabel}
                </span>
              </span>
            )}
          </div>
        )}
      </div>

      {(target.lastTimeLabel !== null || chip !== null) && (
        <div className="hidden shrink-0 flex-col items-end gap-1.5 md:flex">
          {target.lastTimeLabel !== null && (
            <span className="text-[13px] text-ink-3">{target.lastTimeLabel}</span>
          )}
          {chip !== null && chipStyle !== null && (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1',
                chipStyle.container,
              )}
            >
              <span className={cn('text-xs font-semibold', chipStyle.label)}>{chip.label}</span>
              <span className={cn('font-display text-sm font-semibold', chipStyle.value)}>
                {chip.valueLabel}
              </span>
            </span>
          )}
        </div>
      )}
    </li>
  );
}
