import Link from 'next/link';

import { Badge } from '@/components/shared/Badge';
import type { ScheduledWorkoutDetailDto } from '@/application/dto/program';
import type { EquipmentType } from '@/domain/types/exercise';
import { EQUIPMENT_LABELS } from '@/features/exercises/exercise-labels';

interface WorkoutDetailHeaderProps {
  readonly workout: ScheduledWorkoutDetailDto;
  /** Distinct equipment types of the workout's exercises, in row order. */
  readonly equipmentSummary: ReadonlyArray<EquipmentType>;
}

/**
 * Workout detail header (locked design): breadcrumb (program / week /
 * workout), Sora 36 title, and the meta badges (duration, exercise count,
 * equipment summary).
 *
 * The breadcrumb's first link is the program (accent-strong), matching the
 * program detail's "Programs /" pattern; week and workout are plain text
 * because no week route exists to link to.
 */
export function WorkoutDetailHeader({ workout, equipmentSummary }: WorkoutDetailHeaderProps) {
  const { programName, programSlug, weekNumber, order } = workout;
  const exerciseCount = workout.workout.exercises.length;
  const equipmentLabel = equipmentSummary
    .slice(0, 3)
    .map((equipment) => EQUIPMENT_LABELS[equipment])
    .join(' · ');

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2">
        <Link
          href={`/programs/${programSlug}`}
          className="text-[13px] font-medium text-accent-foreground underline-offset-4 hover:underline md:text-sm"
        >
          {programName}
        </Link>
        <span aria-hidden="true" className="text-[13px] text-ink-3 md:text-sm">
          /
        </span>
        <span className="text-[13px] text-ink-3 md:text-sm">Week {weekNumber}</span>
        <span aria-hidden="true" className="text-[13px] text-ink-3 md:text-sm">
          /
        </span>
        <span aria-current="page" className="text-[13px] text-ink-3 md:text-sm">
          Workout {order}
        </span>
      </nav>

      <h1 className="font-display text-[26px] font-bold tracking-tight text-foreground md:text-4xl">
        {workout.workout.name}
      </h1>

      <div className="flex flex-wrap gap-2">
        <Badge>
          <span className="md:hidden">{workout.workout.estimatedDurationMinutes} min</span>
          <span className="hidden md:inline">
            About {workout.workout.estimatedDurationMinutes} minutes
          </span>
        </Badge>
        <Badge>
          {exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'}
        </Badge>
        {equipmentLabel !== '' && <Badge>{equipmentLabel}</Badge>}
      </div>

      <p className="max-w-3xl text-sm text-ink-2 md:max-w-[760px] md:text-[17px]">
        {workout.workout.description}
      </p>
    </div>
  );
}
